import { StateGraph, START, END, Command } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { 
  AgentStateAnnotation, 
  SupervisorStateAnnotation, 
  ResearcherStateAnnotation,
  ResearcherOutputStateAnnotation,
  AgentInputState,
  AgentState,
  SupervisorState,
  ResearcherState,
  ClarifyWithUserSchema,
  ResearchQuestionSchema,
  ConductResearchSchema,
  ResearchCompleteSchema
} from './state.js';
import {
  clarifyWithUserInstructions,
  transformMessagesIntoResearchTopicPrompt,
  leadResearcherPrompt,
  researchSystemPrompt,
  compressResearchSystemPrompt,
  compressResearchSimpleHumanMessage,
  finalReportGenerationPrompt
} from './prompts.js';
import {
  initChatModel,
  getAllTools,
  getTodayStr,
  isTokenLimitExceeded,
  getModelTokenLimit,
  removeUpToLastAIMessage,
  getNotesFromToolCalls,
  getBufferString,
  openaiWebsearchCalled,
  anthropicWebsearchCalled
} from './utils.js';
import { Configuration, ConfigurationManager } from './config.js';

// Create configurable chat model
function createConfigurableModel(config: Configuration) {
  return {
    withStructuredOutput: (schema: any) => {
      return {
        invoke: async (messages: any[], modelConfig?: { model: string; maxTokens: number; apiKey: string }) => {
          if (!modelConfig) throw new Error('Model config required');
          
          const model = initChatModel(modelConfig.model, modelConfig.apiKey, modelConfig.maxTokens);
          const response = await model.invoke(messages);
          
          // For structured output, we'd need to implement schema validation
          // This is a simplified implementation
          return response;
        }
      };
    },
    bind: (tools: any[]) => {
      return {
        invoke: async (messages: any[], modelConfig?: { model: string; maxTokens: number; apiKey: string }) => {
          if (!modelConfig) throw new Error('Model config required');
          
          const model = initChatModel(modelConfig.model, modelConfig.apiKey, modelConfig.maxTokens);
          // Bind tools to model - this would need proper implementation
          return model.invoke(messages);
        }
      };
    },
    invoke: async (messages: any[], modelConfig?: { model: string; maxTokens: number; apiKey: string }) => {
      if (!modelConfig) throw new Error('Model config required');
      
      const model = initChatModel(modelConfig.model, modelConfig.apiKey, modelConfig.maxTokens);
      return model.invoke(messages);
    }
  };
}

// Clarify with user node
async function clarifyWithUser(state: AgentState): Promise<Partial<AgentState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  if (!config.allowClarification) {
    // Command(goto="write_research_brief")
    return {};
  }

  const messages = state.messages || [];
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  try {
    const model = createConfigurableModel(config).withStructuredOutput(ClarifyWithUserSchema);
    const prompt = clarifyWithUserInstructions
      .replace('{messages}', getBufferString(messages))
      .replace('{date}', getTodayStr());

    const response = await model.invoke([new HumanMessage(prompt)], modelConfig);

    console.log('clarifyWithUser response==========',response);
    
    
    // This would need proper structured output parsing
    // For now, returning simple response
    return {
      messages: [new AIMessage("Let me clarify your request before starting research.")]
    };
  } catch (error) {
    console.error('Error in clarifyWithUser:', error);
    return {
      messages: [new AIMessage("I'll proceed with the research based on your input.")]
    };
  }
}

// Write research brief node
async function writeResearchBrief(state: AgentState): Promise<Partial<AgentState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  try {
    const model = createConfigurableModel(config).withStructuredOutput(ResearchQuestionSchema);
    const prompt = transformMessagesIntoResearchTopicPrompt
      .replace('{messages}', getBufferString(state.messages || []))
      .replace('{date}', getTodayStr());

    const response = await model.invoke([new HumanMessage(prompt)], modelConfig);
    
    // Extract research brief from response
    const researchBrief = "Generated research brief"; // This would be parsed from response
    
    return {
      researchBrief,
      supervisorMessages: [
        new SystemMessage(leadResearcherPrompt
          .replace('{date}', getTodayStr())
          .replace('{maxConcurrentResearchUnits}', config.maxConcurrentResearchUnits.toString())
        ),
        new HumanMessage(researchBrief)
      ]
    };
  } catch (error) {
    console.error('Error in writeResearchBrief:', error);
    throw error;
  }
}

// Supervisor node
async function supervisor(state: SupervisorState): Promise<Partial<SupervisorState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  const tools = [ConductResearchSchema, ResearchCompleteSchema];
  const supervisorMessages = state.supervisorMessages || [];

  try {
    const model = createConfigurableModel(config).bind(tools);
    const response = await model.invoke(supervisorMessages, modelConfig);
    
    return {
      supervisorMessages: [...supervisorMessages, response],
      researchIterations: (state.researchIterations || 0) + 1
    };
  } catch (error) {
    console.error('Error in supervisor:', error);
    throw error;
  }
}

// Supervisor tools node
async function supervisorTools(state: SupervisorState): Promise<Partial<SupervisorState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const supervisorMessages = state.supervisorMessages || [];
  const researchIterations = state.researchIterations || 0;
  const mostRecentMessage = supervisorMessages[supervisorMessages.length - 1];

  // Exit criteria checks
  const exceededIterations = researchIterations >= config.maxResearcherIterations;
  const noToolCalls = !mostRecentMessage || !(mostRecentMessage as any).tool_calls;
  
  if (exceededIterations || noToolCalls) {
    return {
      notes: getNotesFromToolCalls(supervisorMessages),
      researchBrief: state.researchBrief || ''
    };
  }

  // Execute research tasks
  try {
    // This would implement the actual research execution
    // For now, returning mock data
    return {
      supervisorMessages: [...supervisorMessages, new ToolMessage({ 
        content: "Research completed", 
        tool_call_id: "test", 
        name: "ConductResearch" 
      })],
      rawNotes: ["Mock research notes"]
    };
  } catch (error) {
    console.error('Error in supervisorTools:', error);
    return {
      notes: getNotesFromToolCalls(supervisorMessages),
      researchBrief: state.researchBrief || ''
    };
  }
}

// Researcher node
async function researcher(state: ResearcherState): Promise<Partial<ResearcherState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const researcherMessages = state.researcherMessages || [];
  const tools = await getAllTools(config);
  
  if (tools.length === 0) {
    throw new Error('No tools found to conduct research');
  }

  const modelConfig = {
    model: config.researchModel,
    maxTokens: config.researchModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.researchModel)!
  };

  try {
    const model = createConfigurableModel(config).bind(tools);
    const response = await model.invoke(researcherMessages, modelConfig);
    
    return {
      researcherMessages: [...researcherMessages, response],
      toolCallIterations: (state.toolCallIterations || 0) + 1
    };
  } catch (error) {
    console.error('Error in researcher:', error);
    throw error;
  }
}

// Researcher tools node
async function researcherTools(state: ResearcherState): Promise<Partial<ResearcherState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const researcherMessages = state.researcherMessages || [];
  const mostRecentMessage = researcherMessages[researcherMessages.length - 1];

  // Check for exit conditions
  if (!mostRecentMessage || !(mostRecentMessage as any).tool_calls) {
    return {}; // Continue to compress_research
  }

  // Execute tools
  const tools = await getAllTools(config);
  const toolCalls = (mostRecentMessage as any).tool_calls || [];
  
  try {
    const toolOutputs = await Promise.all(
      toolCalls.map(async (toolCall: any) => {
        const tool = tools.find(t => t.name === toolCall.name);
        if (tool) {
          const result = await tool.func(toolCall.args);
          return new ToolMessage({
            content: result,
            name: toolCall.name,
            tool_call_id: toolCall.id
          });
        }
        return new ToolMessage({
          content: `Tool ${toolCall.name} not found`,
          name: toolCall.name,
          tool_call_id: toolCall.id
        });
      })
    );

    return {
      researcherMessages: [...researcherMessages, ...toolOutputs]
    };
  } catch (error) {
    console.error('Error in researcherTools:', error);
    return {};
  }
}

// Compress research node
async function compressResearch(state: ResearcherState): Promise<Partial<ResearcherState>> {
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  
  const modelConfig = {
    model: config.compressionModel,
    maxTokens: config.compressionModelMaxTokens,
    apiKey: configManager.getApiKeyForModel(config.compressionModel)!
  };

  let researcherMessages = [...(state.researcherMessages || [])];
  
  // Update system message for compression
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
      const model = createConfigurableModel(config);
      const response = await model.invoke(researcherMessages, modelConfig);
      
      return {
        compressedResearch: response.content?.toString() || '',
        rawNotes: [getBufferString(researcherMessages)]
      };
    } catch (error) {
      synthesisAttempts++;
      
      if (isTokenLimitExceeded(error, config.compressionModel)) {
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
async function finalReportGeneration(state: AgentState): Promise<Partial<AgentState>> {
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
      const model = createConfigurableModel(config);
      const response = await model.invoke([new HumanMessage(prompt)], modelConfig);
      
      return {
        finalReport: response.content?.toString() || '',
        messages: [response],
        notes: [] // Clear notes
      };
    } catch (error) {
      if (isTokenLimitExceeded(error, config.finalReportModel)) {
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
      return {
        finalReport: `Error generating final report: ${error}`,
        notes: []
      };
    }
  }

  return {
    finalReport: 'Error generating final report: Maximum retries exceeded',
    notes: []
  };
}

// Build the researcher subgraph
const researcherBuilder = new StateGraph(ResearcherStateAnnotation)
  .addNode('researcher', researcher)
  .addNode('researcher_tools', researcherTools)
  .addNode('compress_research', compressResearch)
  .addEdge(START, 'researcher')
  .addConditionalEdges('researcher', (state: ResearcherState) => {
    const messages = state.researcherMessages || [];
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage || !(lastMessage as any).tool_calls) {
      return 'compress_research';
    }
    
    const toolCallIterations = state.toolCallIterations || 0;
    const configManager = new ConfigurationManager();
    const maxCalls = configManager.getConfig().maxReactToolCalls;
    
    if (toolCallIterations >= maxCalls) {
      return 'compress_research';
    }
    
    return 'researcher_tools';
  }, {
    'researcher_tools': 'researcher_tools',
    'compress_research': 'compress_research'
  })
  .addEdge('researcher_tools', 'researcher')
  .addEdge('compress_research', END);

// Build the supervisor subgraph
const supervisorBuilder = new StateGraph(SupervisorStateAnnotation)
  .addNode('supervisor', supervisor)
  .addNode('supervisor_tools', supervisorTools)
  .addEdge(START, 'supervisor')
  .addEdge('supervisor', 'supervisor_tools')
  .addConditionalEdges('supervisor_tools', (state: SupervisorState) => {
    const researchIterations = state.researchIterations || 0;
    const configManager = new ConfigurationManager();
    const maxIterations = configManager.getConfig().maxResearcherIterations;
    
    if (researchIterations >= maxIterations) {
      return END;
    }
    
    const supervisorMessages = state.supervisorMessages || [];
    const lastMessage = supervisorMessages[supervisorMessages.length - 1];
    
    if (!lastMessage || !(lastMessage as any).tool_calls) {
      return END;
    }
    
    return 'supervisor';
  }, {
    'supervisor': 'supervisor',
    [END]: END
  });

// Build the main deep researcher graph
const deepResearcherBuilder = new StateGraph(AgentStateAnnotation)
  .addNode('clarify_with_user', clarifyWithUser)
  .addNode('write_research_brief', writeResearchBrief)
  .addNode('research_supervisor', supervisorBuilder.compile() as any)
  .addNode('final_report_generation', finalReportGeneration)
  .addEdge(START, 'clarify_with_user')
  .addEdge('clarify_with_user', END)
  .addConditionalEdges('clarify_with_user', (state: AgentState) => {
    // Check if clarification was needed
    const messages = state.messages || [];
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.content.toString().includes('clarification')) {
      return END; // Need user input
    }
    
    return 'write_research_brief';
  }, {
    'write_research_brief': 'write_research_brief',
    [END]: END
  })
  .addEdge('write_research_brief', 'research_supervisor')
  .addEdge('research_supervisor', 'final_report_generation')
  .addEdge('final_report_generation', END);

// Export the compiled graph
export const deepResearcher = deepResearcherBuilder.compile({
  checkpointer: new MemorySaver()
}); 
