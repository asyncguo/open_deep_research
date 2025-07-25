import axios from 'axios';
import { z } from 'zod';
import { BaseMessage, ToolMessage, AIMessage, filterMessages } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatDeepSeek } from '@langchain/deepseek';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Configuration, SearchAPI } from './config.js';
import { Summary, SummarySchema, ResearchComplete, ResearchCompleteSchema } from './state.ts';
import { summarizeWebpagePrompt } from './prompts.ts';

// Date utility function
export function getTodayStr(): string {
  const today = new Date();
  return today.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Model token limits map
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'openai:gpt-4o-mini': 128000,
  'openai:gpt-4o': 128000,
  'openai:gpt-4-turbo': 128000,
  'openai:gpt-4': 8192,
  'openai:gpt-3.5-turbo': 16385,
  'anthropic:claude-3-5-sonnet': 200000,
  'anthropic:claude-3-5-haiku': 200000,
  'anthropic:claude-3-opus': 200000,
  'anthropic:claude-3-sonnet': 200000,
  'anthropic:claude-3-haiku': 200000,
  'google:gemini-1.5-pro': 2097152,
  'google:gemini-1.5-flash': 1048576
};

// Get model token limit
export function getModelTokenLimit(modelString: string): number | undefined {
  return MODEL_TOKEN_LIMITS[modelString];
}

// Initialize chat model based on model string
export function initChatModel(modelName: string, apiKey: string, maxTokens?: number): BaseChatModel {
  const modelLower = modelName.toLowerCase();
  
  if (modelLower.startsWith('openai:')) {
    const modelType = modelName.substring(7); // Remove 'openai:' prefix
    return new ChatOpenAI({
      apiKey,
      model: modelType,
      maxTokens: maxTokens || 4000,
      temperature: 0
    });
  } else if (modelLower.startsWith('anthropic:')) {
    const modelType = modelName.substring(10); // Remove 'anthropic:' prefix
    return new ChatAnthropic({
      apiKey,
      model: modelType,
      maxTokens: maxTokens || 4000,
      temperature: 0
    });
  }
  
  throw new Error(`Unsupported model: ${modelName}`);
}

// Tavily search interface
interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  rawContent?: string;
}

interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
}

// Tavily search function
export async function tavilySearchAsync(
  searchQueries: string[],
  maxResults = 5,
  topic: 'general' | 'news' | 'finance' = 'general',
  includeRawContent = true,
  apiKey: string
): Promise<TavilySearchResponse[]> {
  const searchTasks = searchQueries.map(async (query) => {
    try {
      const response = await axios.post(
        'https://api.tavily.com/search',
        {
          api_key: apiKey,
          query,
          max_results: maxResults,
          include_raw_content: includeRawContent,
          topic
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        query,
        results: response.data.results || []
      };
    } catch (error) {
      console.error(`Error searching for "${query}":`, error);
      return {
        query,
        results: []
      };
    }
  });

  return Promise.all(searchTasks);
}

// Summarize webpage content
export async function summarizeWebpage(
  model: BaseChatModel,
  webpageContent: string,
  date: string
): Promise<string> {
  try {
    const prompt = summarizeWebpagePrompt
      .replace('{webpageContent}', webpageContent)
      .replace('{date}', date);

    const response = await model.invoke([{ role: 'user', content: prompt }]);
    const content = response.content as string;
    
    // Try to parse as JSON to get structured output
    try {
      const parsed = JSON.parse(content);
      if (parsed.summary && parsed.keyExcerpts) {
        return `<summary>\n${parsed.summary}\n</summary>\n\n<key_excerpts>\n${parsed.keyExcerpts}\n</key_excerpts>`;
      }
    } catch {
      // If not valid JSON, return as is
    }
    
    return content;
  } catch (error) {
    console.error('Failed to summarize webpage:', error);
    return webpageContent;
  }
}

// Create Tavily search tool
export function createTavilySearchTool(apiKey: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'tavily_search',
    description: 'A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events.',
    schema: z.object({
      queries: z.array(z.string()).describe('List of search queries'),
      maxResults: z.number().default(5).describe('Maximum number of results to return'),
      topic: z.enum(['general', 'news', 'finance']).default('general').describe('Topic to filter results by')
    }) as any,
    func: async ({ queries, maxResults, topic }) => {
      const searchResults = await tavilySearchAsync(queries, maxResults, topic, true, apiKey);
      
      let formattedOutput = 'Search results:\n\n';
      const uniqueResults: Record<string, TavilySearchResult & { query: string }> = {};
      
      // Deduplicate results by URL
      for (const response of searchResults) {
        for (const result of response.results) {
          if (!uniqueResults[result.url]) {
            uniqueResults[result.url] = { ...result, query: response.query };
          }
        }
      }

      const maxCharToInclude = 50000;
      const results = Object.values(uniqueResults);
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result) {
          formattedOutput += `\n\n--- SOURCE ${i + 1}: ${result.title} ---\n`;
          formattedOutput += `URL: ${result.url}\n\n`;
          
          // Use raw content if available, otherwise use regular content
          const content = result.rawContent || result.content;
          const truncatedContent = content.substring(0, maxCharToInclude);
          
          formattedOutput += `CONTENT:\n${truncatedContent}\n\n`;
          formattedOutput += '\n\n' + '-'.repeat(80) + '\n';
        }
      }

      return formattedOutput || 'No valid search results found. Please try different search queries.';
    }
  });
}

// Create research complete tool
export function createResearchCompleteTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'ResearchComplete',
    description: 'Call this tool to indicate that the research is complete.',
    schema: ResearchCompleteSchema as any,
    func: async ({ completed }) => {
      return `Research marked as ${completed ? 'complete' : 'incomplete'}`;
    }
  });
}

// Get all available tools based on configuration
export async function getAllTools(config: Configuration): Promise<DynamicStructuredTool[]> {
  const tools: DynamicStructuredTool[] = [createResearchCompleteTool()];
  
  // Add search tools based on configuration
  if (config.searchApi === SearchAPI.TAVILY && config.tavilyApiKey) {
    tools.push(createTavilySearchTool(config.tavilyApiKey));
  }
  
  // TODO: Add OpenAI and Anthropic native web search tools when available
  // TODO: Add MCP tools integration
  
  return tools;
}

// Check if token limit is exceeded
export function isTokenLimitExceeded(error: any, modelName?: string): boolean {
  const errorStr = error.toString().toLowerCase();
  
  // Check for common token limit error patterns
  const tokenLimitPatterns = [
    'token',
    'context',
    'length',
    'maximum context',
    'reduce',
    'prompt is too long',
    'context_length_exceeded',
    'invalid_request_error'
  ];
  
  return tokenLimitPatterns.some(pattern => errorStr.includes(pattern));
}

// Remove messages up to the last AI message
export function removeUpToLastAIMessage(messages: BaseMessage[]): BaseMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof AIMessage) {
      return messages.slice(0, i);
    }
  }
  return messages;
}

// Get notes from tool calls in messages
export function getNotesFromToolCalls(messages: BaseMessage[]): string[] {
  const toolMessages = filterMessages(messages, { includeTypes: ['tool'] }) as ToolMessage[];
  return toolMessages.map(msg => msg.content.toString());
}

// Check if OpenAI web search was called (placeholder)
export function openaiWebsearchCalled(response: any): boolean {
  // TODO: Implement OpenAI web search detection
  return false;
}

// Check if Anthropic web search was called (placeholder)
export function anthropicWebsearchCalled(response: any): boolean {
  // TODO: Implement Anthropic web search detection
  return false;
}

// Get buffer string from messages
export function getBufferString(messages: BaseMessage[]): string {
  return messages.map(msg => {
    const role = msg._getType();
    const content = msg.content.toString();
    return `${role}: ${content}`;
  }).join('\n\n');
} 