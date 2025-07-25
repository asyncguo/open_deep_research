import { StateGraph, START, END, MemorySaver, Command } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation, ClarifyWithUserSchema, ConductResearchSchema, ResearchCompleteSchema, ResearchQuestionSchema, SupervisorState, SupervisorStateAnnotation } from "./state";
import { AIMessage, getBufferString, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConfigurationManager } from "./config";
import { createModel, getNotesFromToolCalls, getTodayStr } from "./utils";
import { clarifyWithUserInstructions, leadResearcherPrompt, transformMessagesIntoResearchTopicPrompt } from "./prompts";

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

  // console.log('===== clarifyWithUser response ===== \n', response);

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

  console.log('===== writeResearchBrief response ===== \n', response);

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
  // TODO: add tools
  const tools = [ConductResearchSchema, ResearchCompleteSchema];
  const supervisorMessages = state.supervisorMessages || [];

  const model = createModel(modelConfig)
    // .withTools(tools)
    .withRetry({ stopAfterAttempt: config.maxStructuredOutputRetries })

  const response = await model.invoke(supervisorMessages);

  console.log('===== supervisor response ===== \n', response);

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

  // Exit Criteria
  // 1. We have exceeded our max guardrail research iterations
  // 2. No tool calls were made by the supervisor
  // 3. The most recent message contains a ResearchComplete tool call and there is only one tool call in the message
  const exceededIterations = researchIterations >= config.maxResearcherIterations;
  const toolCalls = (mostRecentMessage as any)?.tool_calls;
  const noToolCalls = !mostRecentMessage || !toolCalls;
  const researchCompleteToolCall = toolCalls?.some((toolCall: any) => toolCall.name === 'ResearchComplete') || false;
  const onlyOneToolCall = toolCalls?.length === 1;

  if (exceededIterations || noToolCalls || (researchCompleteToolCall && onlyOneToolCall)) {
    return new Command({ 
      goto: END,
      update: {
        notes: getNotesFromToolCalls(supervisorMessages),
        researchBrief: state.researchBrief || ''
      }
    });
  }

  // Otherwise, conduct research and gather results.
  
  
  return new Command({ goto: END });
}

// Build the supervisor subgraph
const supervisorBuilder = new StateGraph(SupervisorStateAnnotation)
  .addNode("supervisor", supervisor, { ends: ['supervisor_tools'] })
  .addNode('supervisor_tools', supervisorTools, { ends: [END] })
  .addEdge(START, 'supervisor')

// Build the main deep researcher graph
const deepResearcherBuilder = new StateGraph(AgentStateAnnotation)
  .addNode('clarify_with_user', clarifyWithUser, { ends: ['write_research_brief', END] })
  .addNode('write_research_brief', writeResearchBrief, { ends: ['research_supervisor'] })
  .addNode('research_supervisor', supervisorBuilder.compile() as any, { ends: [END] })
  // .addNode('final_report_generation', finalReportGeneration)
  .addEdge(START, 'clarify_with_user');

// Export the compiled graph
export const deepResearcher = deepResearcherBuilder.compile({
  // checkpointer: new MemorySaver()
});
