import { StateGraph, START, END, Command } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation, ClarifyWithUserSchema, ConductResearch, ResearchComplete, ResearcherState, ResearchQuestionSchema, SupervisorState, SupervisorStateAnnotation, ResearcherStateAnnotation } from "./state";
import { AIMessage, getBufferString, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ConfigurationManager } from "./config";
import { createModel, getAllTools, getModelTokenLimit, getNotesFromToolCalls, getTodayStr, isTokenLimitExceeded, removeUpToLastAIMessage } from "./utils";
import { clarifyWithUserInstructions, compressResearchSimpleHumanMessage, compressResearchSystemPrompt, finalReportGenerationPrompt, leadResearcherPrompt, researchSystemPrompt, transformMessagesIntoResearchTopicPrompt } from "./prompts";

// Clarify with user node
async function clarifyWithUser(state: AgentState): Promise<Partial<AgentState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  if (!config.allowClarification) {
    return new Command({ goto: 'write_research_brief' });
  }

  const messages = state.messages || [];
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  const model = createModel(modelConfig)
    .withStructuredOutput(ClarifyWithUserSchema)
    .withRetry({ stopAfterAttempt: config.maxStructuredOutputRetries })
  
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
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  const model = createModel(modelConfig)
    .withStructuredOutput(ResearchQuestionSchema)
    .withRetry({ stopAfterAttempt: config.maxStructuredOutputRetries })

  const prompt = transformMessagesIntoResearchTopicPrompt
    .replace('{messages}', getBufferString(state.messages || []))
    .replace('{date}', getTodayStr());

  const response = await model.invoke([new HumanMessage(prompt)]);

  // console.log('===== writeResearchBrief response ===== \n', response);

  return new Command({
    goto: 'research_supervisor',
    update: {
      researchBrief: response.researchBrief,
      supervisorMessages: [
        new SystemMessage(leadResearcherPrompt
          .replace('{date}', getTodayStr())
          .replace('{maxConcurrentResearchUnits}', config.maxConcurrentResearchUnits.toString())
        ),
        new HumanMessage(response.researchBrief)
      ]
    }
  });
}

async function supervisor(state: SupervisorState): Promise<Partial<SupervisorState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };
  const leadResearcherTools = [ConductResearch, ResearchComplete];
  const supervisorMessages = state.supervisorMessages || [];

  const model = createModel(modelConfig)
    // .withTools(tools)
    .bindTools(leadResearcherTools)
    .withRetry({ stopAfterAttempt: config.maxStructuredOutputRetries })

  const response = await model.invoke(supervisorMessages);

  // console.log('===== supervisor response ===== \n', response);

  return new Command({ 
    goto: 'supervisor_tools',
    update: {
      supervisorMessages: [...supervisorMessages, response],
      researchIterations: (state.researchIterations || 0) + 1
    }
  });
}
async function supervisorTools(state: SupervisorState): Promise<Partial<SupervisorState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const supervisorMessages = state.supervisorMessages || [];
  const researchIterations = state.researchIterations || 0;
  const mostRecentMessage = supervisorMessages[supervisorMessages.length - 1];

  // console.log('===== supervisorTools mostRecentMessage ===== \n', mostRecentMessage);

  // Exit Criteria
  // 1. We have exceeded our max guardrail research iterations
  // 2. No tool calls were made by the supervisor
  // 3. The most recent message contains a ResearchComplete tool call and there is only one tool call in the message
  const exceededIterations = researchIterations >= config.maxResearcherIterations;
  const toolCalls = (mostRecentMessage as any)?.tool_calls;
  const noToolCalls = !mostRecentMessage || !toolCalls || toolCalls.length === 0;
  const researchCompleteToolCall = toolCalls?.some((toolCall: any) => toolCall.name === 'ResearchComplete') || false;
  const onlyOneToolCall = toolCalls?.length === 1;

  if (exceededIterations || noToolCalls) {
    return new Command({ 
      goto: END,
      update: {
        notes: getNotesFromToolCalls(supervisorMessages),
        researchBrief: state.researchBrief || ''
      }
    });
  }

  // Special handling for ResearchComplete tool call - we must generate tool messages for all tool calls
  if (researchCompleteToolCall && onlyOneToolCall) {
    // Generate tool message for ResearchComplete before exiting
    const researchCompleteCall = toolCalls.find((toolCall: any) => toolCall.name === 'ResearchComplete');
    const researchCompleteMessage = new ToolMessage({
      content: "Research completed successfully.",
      name: "ResearchComplete",
      tool_call_id: researchCompleteCall.id
    });

    return new Command({ 
      goto: END,
      update: {
        supervisorMessages: [researchCompleteMessage],
        notes: getNotesFromToolCalls([...supervisorMessages, researchCompleteMessage]),
        researchBrief: state.researchBrief || ''
      }
    });
  }

  // Otherwise, conduct research and gather results.
  const allConductResearchCalls = (mostRecentMessage as any).tool_calls?.filter(
    (toolCall: any) => toolCall.name === "ConductResearch"
  ) || [];

  // console.log('===== supervisorTools allConductResearchCalls ===== \n', allConductResearchCalls);

  const conductResearchCalls = allConductResearchCalls.slice(0, config.maxConcurrentResearchUnits);
  const overflowConductResearchCalls = allConductResearchCalls.slice(config.maxConcurrentResearchUnits);

  const researcherSystemPrompt = researchSystemPrompt
    .replace('{mcp_prompt}', config.mcpPrompt || '')
    .replace('{date}', getTodayStr());

  console.log('===== supervisorTools log conductResearchCalls ===== \n', conductResearchCalls);
  
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
      content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${config.maxConcurrentResearchUnits} or fewer research units.`,
      name: "ConductResearch",
      tool_call_id: overflowConductResearchCall.id
    }));
  }

  const rawNotesConcat = toolResults
    .map((observation: any) => (observation.rawNotes || []).join('\n'))
    .join('\n');

  // Handle ResearchComplete tool calls if present (mixed with ConductResearch)
  const allToolCalls = (mostRecentMessage as any).tool_calls || [];
  const researchCompleteToolCalls = allToolCalls.filter((toolCall: any) => toolCall.name === 'ResearchComplete');
  const researchCompleteMessages = researchCompleteToolCalls.map((toolCall: any) => 
    new ToolMessage({
      content: "Research completed successfully.",
      name: "ResearchComplete",
      tool_call_id: toolCall.id
    })
  );

  // Combine all tool messages
  const allToolMessages = [...toolMessages, ...researchCompleteMessages];

  // If there are ResearchComplete calls, exit to END
  if (researchCompleteMessages.length > 0) {
    return new Command({
      goto: END,
      update: {
        supervisorMessages: allToolMessages,
        notes: getNotesFromToolCalls([...supervisorMessages, ...allToolMessages]),
        researchBrief: state.researchBrief || ''
      }
    });
  }

  return new Command({
    goto: "supervisor",
    update: {
      supervisorMessages: allToolMessages,
      rawNotes: [rawNotesConcat]
    }
  });
}

// Researcher node
async function researcher(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();

  console.log('===== researcher state ===== \n');
  const researcherMessages = state.researcherMessages || [];
  const tools = await getAllTools(config);

  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  // console.log('===== researcher tools ===== \n', tools);

  const model = createModel(modelConfig)
    .bindTools(tools)
    .withRetry({ stopAfterAttempt: config.maxStructuredOutputRetries })
  // console.log('===== researcherMessages ===== \n', researcherMessages);
  const response = await model.invoke(researcherMessages);

  // console.log('===== researcher response ===== \n', response);

  return new Command({
    goto: 'researcher_tools',
    update: {
      researcherMessages: [...researcherMessages, response],
      toolCallIterations: (state.toolCallIterations || 0) + 1
    }
  });
}

// Researcher tools node
async function researcherTools(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const researcherMessages = state.researcherMessages || [];
  const mostRecentMessage = researcherMessages[researcherMessages.length - 1];

  // Early Exit Criteria: No tool calls (or native web search calls)were made by the researcher
  if (!mostRecentMessage || !(mostRecentMessage as any).tool_calls) {
    console.log('===== researcherTools: No tool calls, going to compress_research =====');
    return new Command({
      goto: 'compress_research'
    });
  }

  // Otherwise, execute tools and gather results.
  const tools = await getAllTools(config);
  const toolCalls = (mostRecentMessage as any).tool_calls || [];

  console.log('===== researcherTools: Starting Promise.all for tools =====', toolCalls);
  const toolOutputs = await Promise.all(
    toolCalls.map(async (toolCall: any, index: number) => {
      try {
        const tool = tools.find(t => t.name === toolCall.name);
        if (tool) {
          const result = await tool.invoke(toolCall);
          // console.log('===== researcherTools: tool result ===== \n', result);
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

  // console.log('===== researcherTools: Promise.all completed, toolOutputs count =====', toolOutputs.length);

  // Late Exit Criteria: We have exceeded our max guardrail tool call iterations or the most recent message contains a ResearchComplete tool call
  // These are late exit criteria because we need to add ToolMessages
  const exceededToolCalls = state.toolCallIterations >= config.maxResearcherIterations;
  const researchCompleteToolCall = toolCalls.some((toolCall: any) => toolCall.name === 'ResearchComplete');

  if (exceededToolCalls || researchCompleteToolCall) {
    console.log('===== researcherTools: Exceeded tool calls or research complete tool call, going to compress_research =====');
    return new Command({
      goto: 'compress_research',
      update: {
        researcherMessages: [...toolOutputs]
      }
    });
  }

  // console.log('===== researcherTools toolOutputs ===== \n', toolOutputs);

  // Otherwise, continue to researcher
  return new Command({
    goto: 'researcher',
    update: {
      researcherMessages: [...toolOutputs]
    }
  });
}

// Compress research node
async function compressResearch(state: ResearcherState): Promise<Partial<ResearcherState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.compressionModel,
    maxTokens: config.compressionModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.compressionModel)!
  };

  console.log('===== compressResearch state ===== \n');
  // return

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
      const model = createModel(modelConfig);
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

// Final report generation node
async function finalReportGeneration(state: AgentState): Promise<Partial<AgentState> | Command> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const notes = state.notes || [];
  const findings = notes.join('\n');
  
  const modelConfig = {
    model: config.finalReportModel,
    maxTokens: config.finalReportModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.finalReportModel)!
  };

  let currentRetry = 0;
  const maxRetries = 3;
  let currentFindings = findings;

  while (currentRetry <= maxRetries) {
    const prompt = finalReportGenerationPrompt
      .replace('{researchBrief}', state.researchBrief || '')
      .replace('{findings}', currentFindings)
      .replace('{date}', getTodayStr());

    try {
      const model = createModel(modelConfig);
      const response = await model.invoke([new HumanMessage(prompt)]);
      
      return new Command({
        goto: END,
        update: {
          finalReport: response.content?.toString() || '',
          messages: [response],
          notes: [] // Clear notes
        }
      });
    } catch (error) {
      if (isTokenLimitExceeded(error)) {
        const modelTokenLimit = getModelTokenLimit(config.finalReportModel);
        if (modelTokenLimit) {
          const findingsTokenLimit = currentRetry === 0 
            ? modelTokenLimit * 4 
            : Math.floor(currentFindings.length * 0.9);
          
          currentFindings = currentFindings.substring(0, findingsTokenLimit);
          currentRetry++;
          continue;
        }
      }
      
      console.error('Error generating final report:', error);
      return new Command({
        goto: END,
        update: {
          finalReport: `Error generating final report: ${error}`,
          notes: []
        }
      });
    }
  }

  return new Command({
    goto: END,
    update: {
      finalReport: 'Error generating final report: Maximum retries exceeded',
      notes: []
    }
  });
}

// Build the researcher subgraph
const researcherBuilder = new StateGraph(ResearcherStateAnnotation)
  .addNode('researcher', researcher, { ends: ['researcher_tools'] })
  .addNode('researcher_tools', researcherTools, { ends: ['compress_research', 'researcher'] })
  .addNode('compress_research', compressResearch)
  .addEdge(START, 'researcher')
  .addEdge('compress_research', END)

const researcherSubgraph = researcherBuilder.compile() as any;

// Build the supervisor subgraph
const supervisorBuilder = new StateGraph(SupervisorStateAnnotation)
  .addNode("supervisor", supervisor, { ends: ['supervisor_tools'] })
  .addNode('supervisor_tools', supervisorTools, { ends: ['supervisor', END] })
  .addEdge(START, 'supervisor')

// Build the main deep researcher graph
const deepResearcherBuilder = new StateGraph(AgentStateAnnotation)
  .addNode('clarify_with_user', clarifyWithUser, { ends: ['write_research_brief', END] })
  .addNode('write_research_brief', writeResearchBrief, { ends: ['research_supervisor'] })
  .addNode('research_supervisor', supervisorBuilder.compile() as any)
  .addNode('final_report_generation', finalReportGeneration)
  .addEdge(START, 'clarify_with_user')
  .addEdge('research_supervisor', 'final_report_generation')
  .addEdge('final_report_generation', END);

// Export the compiled graph
export const deepResearcherAgent = deepResearcherBuilder.compile();
