import { Command, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation, ClarifyWithUserSchema, ConductResearch, ResearchComplete, ResearcherOutputStateAnnotation, ResearcherState, ResearcherStateAnnotation, ResearchQuestionSchema, SupervisorState, SupervisorStateAnnotation } from "./state";
import { AIMessage, getBufferString, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { clarifyWithUserInstructions, compressResearchSimpleHumanMessage, compressResearchSystemPrompt, finalReportGenerationPrompt, leadResearcherPrompt, researchSystemPrompt, transformMessagesIntoResearchTopicPrompt } from "./prompts";
import { getAllTools, getNotesFromToolCalls, getTodayStr, isTokenLimitExceeded, removeUpToLastAIMessage } from "./utils";
import { ChatDeepSeek } from "@langchain/deepseek";
import { SearchAPI } from "./config";

import { config } from 'dotenv';
// Load environment variables
config();

const createModel = () => {
  return new ChatDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    modelName: 'deepseek-chat',
    // maxTokens: maxTokens,
    temperature: 0,
  });
}
const maxStructuredOutputRetries = 3
const maxResearcherIterations = 3
const maxConcurrentResearchUnits = 3
const maxReactToolCalls = 5

// Clarify with user node
async function clarifyWithUser(state: AgentState): Promise<Partial<AgentState> | Command> {
  // TODO: allow clarification
  // if (!allowClarification) {
  //   return new Command({ goto: 'write_research_brief' });
  // }

  const model = createModel()
    .withStructuredOutput(ClarifyWithUserSchema)
    .withRetry({ stopAfterAttempt: maxStructuredOutputRetries })
  const messages = state.messages || [];
  const prompt = clarifyWithUserInstructions
    .replace('{messages}', getBufferString(messages))
    .replace('{date}', getTodayStr());

  const response = await model.invoke([new HumanMessage(prompt)]);

  console.log('===== clarifyWithUser response ===== \n', response);

  if (response.needClarification) {
    return new Command({
      goto: END, 
      update: {
        messages: [new AIMessage(response.question)]
      }
    });
  } else {
    return new Command( { 
      goto: 'write_research_brief', 
      update: {
        messages: [new AIMessage(response.verification)],
      }
    })
  }
}
// Write research brief node
async function writeResearchBrief(state: AgentState): Promise<Partial<AgentState> | Command> {
  const model = createModel()
    .withStructuredOutput(ResearchQuestionSchema)
    .withRetry({ stopAfterAttempt: maxStructuredOutputRetries })

  const prompt = transformMessagesIntoResearchTopicPrompt
    .replace('{messages}', getBufferString(state.messages || []))
    .replace('{date}', getTodayStr());

  const response = await model.invoke([new HumanMessage(prompt)]);

  console.log('===== writeResearchBrief response ===== \n', response);

  return new Command({
    goto: 'research_supervisor',
    update: {
      researchBrief: response.researchBrief,
      supervisorMessages: {
        type: 'override',
        value: [
          new SystemMessage(leadResearcherPrompt
            .replace('{date}', getTodayStr())
            .replace('{maxConcurrentResearchUnits}', '3')
          ),
          new HumanMessage(response.researchBrief)
        ]
      }
    }
  });
}
// ===============================
// Supervisor Node
// ===============================
async function supervisor(state: SupervisorState): Promise<Partial<SupervisorState> | Command> {
  const leadResearcherTools = [ConductResearch, ResearchComplete];
  const supervisorMessages = state.supervisorMessages || [];

  const model = createModel()
    .bindTools(leadResearcherTools)
    .withRetry({ stopAfterAttempt: maxStructuredOutputRetries })

  const response = await model.invoke(supervisorMessages);

  console.log('===== supervisor response ===== \n', response);

  return new Command({ 
    goto: 'supervisor_tools',
    update: {
      supervisorMessages: [ response],
      researchIterations: (state.researchIterations || 0) + 1
    }
  });
}

async function supervisorTools(state: SupervisorState): Promise<Partial<SupervisorState> | Command> {
  const supervisorMessages = state.supervisorMessages || [];
  const researchIterations = state.researchIterations || 0;
  const mostRecentMessage = supervisorMessages[supervisorMessages.length - 1];

  // Exit Criteria
  // 1. We have exceeded our max guardrail research iterations
  // 2. No tool calls were made by the supervisor
  // 3. The most recent message contains a ResearchComplete tool call and there is only one tool call in the message
  const exceededIterations = researchIterations >= maxResearcherIterations;
  const toolCalls = (mostRecentMessage as any)?.tool_calls;
  const noToolCalls = !mostRecentMessage || !toolCalls || toolCalls.length === 0;
  const researchCompleteToolCall = toolCalls?.some((toolCall: any) => toolCall.name === 'ResearchComplete') || false;

  if (exceededIterations || noToolCalls || researchCompleteToolCall) {
    return new Command({ 
      goto: END,
      update: {
        notes: getNotesFromToolCalls(supervisorMessages),
        researchBrief: state.researchBrief || ''
      }
    });
  }

  // Otherwise, conduct research and gather results.
  try {
    const allConductResearchCalls = (mostRecentMessage as any).tool_calls?.filter(
      (toolCall: any) => toolCall.name === "ConductResearch"
    ) || [];
  
    const conductResearchCalls = allConductResearchCalls.slice(0, maxConcurrentResearchUnits);
    const overflowConductResearchCalls = allConductResearchCalls.slice(maxConcurrentResearchUnits);
  
    const researcherSystemPrompt = researchSystemPrompt
      .replace('{mcp_prompt}',  '')
      .replace('{date}', getTodayStr());
  
    // console.log('===== supervisorTools log conductResearchCalls ===== \n', conductResearchCalls);
    
    // Create researcher subgraph invocation promises
    const researchPromises = conductResearchCalls.map((toolCall: any) => 
      researcherSubgraph.invoke({
        researcherMessages: [
          new SystemMessage(researcherSystemPrompt),
          new HumanMessage(toolCall.args.researchTopic)
        ],
        researchTopic: toolCall.args.researchTopic
      })
    );
    const toolResults = await Promise.all(researchPromises);

    console.log('===== supervisorTools toolResults ===== \n', toolResults);

    const toolMessages = toolResults.map((observation: any, index: number) => {
      const toolCall = conductResearchCalls[index];
      return new ToolMessage({
        content: observation.compressedResearch || "Error synthesizing research report: Maximum retries exceeded",
        name: toolCall.name,
        tool_call_id: toolCall.id
      });
    });

    // Handle any tool calls made > max_concurrent_research_units
    for (const overflowConductResearchCall of overflowConductResearchCalls) {
      toolMessages.push(new ToolMessage({
        content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${maxConcurrentResearchUnits} or fewer research units.`,
        name: "ConductResearch",
        tool_call_id: overflowConductResearchCall.id
      }));
    }

    const rawNotesConcat = toolResults
      .map((observation: any) => (observation.rawNotes || []).join('\n'))
      .join('\n');

    return new Command({
      goto: "supervisor",
      update: {
        supervisorMessages: [...toolMessages],
        rawNotes: [rawNotesConcat]
      }
    });
  } catch (error) {
    return new Command({
      goto: END,
      update: {
        notes: getNotesFromToolCalls(supervisorMessages),
        researchBrief: state.researchBrief || ''
      }
    });
  }
}

// ===============================
// Researcher Node
// ===============================
async function researcher(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  const researcherMessages = state.researcherMessages || [];
  const tools = await getAllTools({
    searchApi: SearchAPI.TAVILY,
    tavilyApiKey: process.env.TAVILY_API_KEY} as any
  )

  const model = createModel()
    .bindTools(tools)
    .withRetry({ stopAfterAttempt: maxStructuredOutputRetries })
  const response = await model.invoke(researcherMessages);

  return new Command({
    goto: 'researcher_tools',
    update: {
      researcherMessages: [response],
      toolCallIterations: (state.toolCallIterations || 0) + 1
    }
  });
}
async function researcherTools(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  const researcherMessages = state.researcherMessages || [];
  const mostRecentMessage = researcherMessages[researcherMessages.length - 1];

  // Early Exit Criteria: No tool calls (or native web search calls)were made by the researcher
  if (!mostRecentMessage || !(mostRecentMessage as any).tool_calls) {
    return new Command({
      goto: 'compress_research'
    });
  }

  // Otherwise, execute tools and gather results.
  const tools = await getAllTools({
    searchApi: SearchAPI.TAVILY,
    tavilyApiKey: process.env.TAVILY_API_KEY} as any
  );
  const toolCalls = (mostRecentMessage as any).tool_calls || [];

  const toolOutputs = await Promise.all(
    toolCalls.map(async (toolCall: any) => {
      try {
        const tool = tools.find(t => t.name === toolCall.name);
        if (tool) {
          const result = await tool.invoke(toolCall);
          return result;
          // return new ToolMessage({
          //   content: result,
          //   name: toolCall.name,
          //   tool_call_id: toolCall.id
          // });
        }

        return new ToolMessage({
          content: `Tool ${toolCall.name} not found`,
          name: toolCall.name,
          tool_call_id: toolCall.id
        });
      } catch (error) {
        return new ToolMessage({
          content: `Error executing tool ${toolCall.name}: ${error}`,
          name: toolCall.name,
          tool_call_id: toolCall.id
        });
      }
    })
  );


  // Late Exit Criteria: We have exceeded our max guardrail tool call iterations or the most recent message contains a ResearchComplete tool call
  // These are late exit criteria because we need to add ToolMessages
  const exceededToolCalls = state.toolCallIterations >= maxReactToolCalls;
  const researchCompleteToolCall = toolCalls.some((toolCall: any) => toolCall.name === 'ResearchComplete');

  if (exceededToolCalls || researchCompleteToolCall) {
    return new Command({
      goto: 'compress_research',
      update: {
        researcherMessages: [...toolOutputs]
      }
    });
  }

  // Otherwise, continue to researcher
  return new Command({
    goto: 'researcher',
    update: {
      researcherMessages: [...toolOutputs]
    }
  });
}
async function compressResearch(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  console.log('===== compressResearch state ===== \n');
  let researcherMessages = [...(state.researcherMessages || [])];

  // Update the system prompt to now focus on compression rather than research.
  if (researcherMessages.length > 0) {
    researcherMessages[0] = new SystemMessage(
      compressResearchSystemPrompt.replace('{date}', getTodayStr())
    );
  }
  researcherMessages.push(new HumanMessage(compressResearchSimpleHumanMessage));

  let synthesisAttempts = 0;
  const maxAttempts = 3;

  while (synthesisAttempts < maxAttempts) {
    try {
      const model = createModel();
      const response = await model.invoke(researcherMessages);
      
      return {
        compressedResearch: response.content?.toString() || '',
        rawNotes: [getBufferString(researcherMessages)]
      };
    } catch (error) {
      synthesisAttempts++;
      
      if (isTokenLimitExceeded(error)) {
        researcherMessages = removeUpToLastAIMessage(researcherMessages);
        console.log('Token limit exceeded, pruning messages and retrying...');
        continue;
      }
      
      console.error('Error synthesizing research report:', error);
      break;
    }
  }

  return {
    compressedResearch: 'Error synthesizing research report: Maximum retries exceeded',
    rawNotes: [getBufferString(researcherMessages)]
  };
}

async function finalReportGeneration(state: AgentState): Promise<Partial<AgentState> | Command> {
  console.log('===== finalReportGeneration ===== \n');
  const notes = state.notes || [];
  
  const findings = notes.join('\n');
  let currentRetry = 0;
  const maxRetries = 3;
  let currentFindings = findings;

  while (currentRetry <= maxRetries) {
    const prompt = finalReportGenerationPrompt
      .replace('{researchBrief}', state.researchBrief || '')
      .replace('{findings}', currentFindings)
      .replace('{date}', getTodayStr());

    try {
      const model = createModel();
      const response = await model.invoke([new HumanMessage(prompt)]);
      
      return {
        finalReport: response.content?.toString() || '',
        messages: [response],
        notes: [] // Clear notes
      }
    } catch (error) {
      // TODO: token limit exceeded
      // if (isTokenLimitExceeded(error)) {
      //   const modelTokenLimit = getModelTokenLimit('deepseek:deepseek-chat');
      //   if (modelTokenLimit) {
      //     const findingsTokenLimit = currentRetry === 0 
      //       ? modelTokenLimit * 4 
      //       : Math.floor(currentFindings.length * 0.9);
          
      //     currentFindings = currentFindings.substring(0, findingsTokenLimit);
      //     currentRetry++;
      //     continue;
      //   }
      // }
      
      console.error('Error generating final report:', error);
      return {
        finalReport: `Error generating final report: ${error}`,
        notes: []
      }
    }
  }

  return {
    finalReport: 'Error generating final report: Maximum retries exceeded',
    notes: []
  }
}

// ===============================
// Researcher StateGraph
// ===============================
const researcherBuilder = new StateGraph({
  stateSchema: ResearcherStateAnnotation,
  output: ResearcherOutputStateAnnotation
})
  .addNode('researcher', researcher)
  .addNode('researcher_tools', researcherTools, { ends: ['compress_research'] })
  .addNode('compress_research', compressResearch)
  .addEdge(START, 'researcher')
  .addEdge('researcher', 'researcher_tools')
  .addEdge('compress_research', END)

const researcherSubgraph = researcherBuilder.compile()

// ===============================
// Supervisor StateGraph
// ===============================
const supervisorBuilder = new StateGraph(SupervisorStateAnnotation)
  .addNode('supervisor', supervisor, { ends: ['supervisor_tools', END] })
  .addNode('supervisor_tools', supervisorTools, { ends: ['supervisor', END] })
  .addEdge(START, 'supervisor')

const supervisorBuilderGraph = supervisorBuilder.compile()

// ===============================
// Deep Researcher StateGraph
// ===============================
const deepResearcherBuilder = new StateGraph({
  input: MessagesAnnotation,
  stateSchema: AgentStateAnnotation
})
  .addNode('clarify_with_user', clarifyWithUser, { ends: ['write_research_brief', END] })
  .addNode('write_research_brief', writeResearchBrief, { ends: ['research_supervisor'] })
  .addNode('research_supervisor', supervisorBuilderGraph)
  .addNode('final_report_generation', finalReportGeneration)
  .addEdge(START, 'clarify_with_user')
  .addEdge('research_supervisor', 'final_report_generation')
  .addEdge('final_report_generation', END);

// Export the compiled graph
export const deepResearcherAgent = deepResearcherBuilder.compile();
