import { z } from 'zod';
import { config } from 'dotenv';

// Load environment variables
config();

// Enum for search API types
export enum SearchAPI {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  TAVILY = 'tavily',
  NONE = 'none'
}

// MCP Configuration schema
export const MCPConfigSchema = z.object({
  url: z.string().url().optional(),
  tools: z.array(z.string()).optional(),
  authRequired: z.boolean().optional().default(false)
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// Main Configuration schema
export const ConfigurationSchema = z.object({
  // General Configuration
  maxStructuredOutputRetries: z.number().min(1).max(10).default(3),
  allowClarification: z.boolean().default(true),
  maxConcurrentResearchUnits: z.number().min(1).max(20).default(5),
  
  // Research Configuration
  searchApi: z.nativeEnum(SearchAPI).default(SearchAPI.TAVILY),
  maxResearcherIterations: z.number().min(1).max(10).default(3),
  maxReactToolCalls: z.number().min(1).max(30).default(5),
  
  // Model Configuration
  summarizationModel: z.string().default('openai:gpt-4o-mini'),
  summarizationModelMaxTokens: z.number().default(8192),
  researchModel: z.string().default('openai:gpt-4o'),
  researchModelMaxTokens: z.number().default(10000),
  compressionModel: z.string().default('openai:gpt-4o-mini'),
  compressionModelMaxTokens: z.number().default(8192),
  finalReportModel: z.string().default('openai:gpt-4o'),
  finalReportModelMaxTokens: z.number().default(10000),
  
  // MCP Configuration
  mcpConfig: MCPConfigSchema.optional(),
  mcpPrompt: z.string().optional(),
  
  // API Keys
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  deepseekApiKey: z.string().optional()
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

// Configuration class with utility methods
export class ConfigurationManager {
  private config: Configuration;

  constructor(configOverrides: Partial<Configuration> = {}) {
    const defaultConfig = {
      maxStructuredOutputRetries: Number(process.env.MAX_STRUCTURED_OUTPUT_RETRIES) || 3,
      allowClarification: process.env.ALLOW_CLARIFICATION !== 'false',
      maxConcurrentResearchUnits: Number(process.env.MAX_CONCURRENT_RESEARCH_UNITS) || 5,
      searchApi: (process.env.SEARCH_API as SearchAPI) || SearchAPI.TAVILY,
      maxResearcherIterations: Number(process.env.MAX_RESEARCHER_ITERATIONS) || 3,
      maxReactToolCalls: Number(process.env.MAX_REACT_TOOL_CALLS) || 5,
      summarizationModel: process.env.SUMMARIZATION_MODEL || 'openai:gpt-4o-mini',
      summarizationModelMaxTokens: Number(process.env.SUMMARIZATION_MODEL_MAX_TOKENS) || 8192,
      researchModel: process.env.RESEARCH_MODEL || 'openai:gpt-4o',
      researchModelMaxTokens: Number(process.env.RESEARCH_MODEL_MAX_TOKENS) || 10000,
      compressionModel: process.env.COMPRESSION_MODEL || 'openai:gpt-4o-mini',
      compressionModelMaxTokens: Number(process.env.COMPRESSION_MODEL_MAX_TOKENS) || 8192,
      finalReportModel: process.env.FINAL_REPORT_MODEL || 'openai:gpt-4o',
      finalReportModelMaxTokens: Number(process.env.FINAL_REPORT_MODEL_MAX_TOKENS) || 10000,
      openaiApiKey: process.env.OPENAI_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      googleApiKey: process.env.GOOGLE_API_KEY,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      mcpConfig: process.env.MCP_CONFIG ? JSON.parse(process.env.MCP_CONFIG) : undefined,
      mcpPrompt: process.env.MCP_PROMPT,
      ...configOverrides
    };

    this.config = ConfigurationSchema.parse(defaultConfig);
  }

  getConfig(): Configuration {
    return this.config;
  }

  updateConfig(updates: Partial<Configuration>): void {
    this.config = ConfigurationSchema.parse({ ...this.config, ...updates });
  }

  getApiKeyForModel(modelName: string): string | undefined {
    const modelLower = modelName.toLowerCase();
    
    if (modelLower.startsWith('openai:')) {
      return this.config.openaiApiKey;
    } else if (modelLower.startsWith('anthropic:')) {
      return this.config.anthropicApiKey;
    } else if (modelLower.startsWith('google:') || modelLower.startsWith('gemini:')) {
      return this.config.googleApiKey;
    }else if (modelLower.startsWith('deepseek:')) {
      return this.config.deepseekApiKey;
    }
    
    return undefined;
  }

  validateRequiredApiKeys(): void {
    const errors: string[] = [];
    
    if (this.config.searchApi === SearchAPI.TAVILY && !this.config.tavilyApiKey) {
      errors.push('TAVILY_API_KEY is required when using Tavily search');
    }
    
    if (this.config.researchModel.startsWith('openai:') && !this.config.openaiApiKey) {
      errors.push('OPENAI_API_KEY is required for OpenAI models');
    }
    
    if (this.config.researchModel.startsWith('anthropic:') && !this.config.anthropicApiKey) {
      errors.push('ANTHROPIC_API_KEY is required for Anthropic models');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
}

// Export a default configuration instance
export const defaultConfiguration = new ConfigurationManager(); 