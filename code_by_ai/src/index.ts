#!/usr/bin/env node

import { config } from 'dotenv';
import { deepResearcher } from './deepResearcher.js';
import { ConfigurationManager } from './config.js';
import { HumanMessage } from '@langchain/core/messages';

// Load environment variables
config();

// Export the main graph for LangGraph platform
export { deepResearcher };

// Export configuration and utilities
export * from './config.js';
export * from './state.js';
export * from './utils.js';
export * from './prompts.js';

// CLI functionality for local testing
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node dist/index.js "Your research question"');
    process.exit(1);
  }

  const question = args.join(' ');
  console.log('🔍 Starting deep research for:', question);
  
  try {
    // Validate configuration
    const configManager = new ConfigurationManager();
    configManager.validateRequiredApiKeys();
    
    // Create thread configuration
    const threadId = `research-${Date.now()}`;
    const config = {
      configurable: {
        thread_id: threadId
      }
    };

    // Invoke the research graph
    const result = await deepResearcher.invoke(
      {
        messages: [new HumanMessage(question)]
      },
      config
    );

    console.log('\n📋 Research Brief:');
    console.log(result.researchBrief || 'No research brief generated');
    
    console.log('\n📊 Final Report:');
    console.log(result.finalReport || 'No final report generated');
    
  } catch (error) {
    console.error('❌ Error during research:', error);
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 