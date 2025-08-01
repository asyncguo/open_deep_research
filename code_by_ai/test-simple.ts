#!/usr/bin/env tsx

import { config } from 'dotenv';
import { ConfigurationManager } from './src/config';
import { deepResearcher } from './src/deepResearcher';

// Load environment variables
config();

async function testBasicFunctionality() {
  console.log('🧪 Testing Open Deep Research JS...\n');

  try {
    // Test configuration loading
    console.log('1. Testing configuration loading...');
    const configManager = new ConfigurationManager();
    const config = configManager.getConfig();
    console.log('✅ Configuration loaded successfully');
    console.log(`   - Research model: ${config.researchModel}`);
    console.log(`   - Search API: ${config.searchApi}`);
    console.log(`   - Max iterations: ${config.maxResearcherIterations}\n`);

    // Test graph compilation
    console.log('2. Testing graph compilation...');
    console.log('✅ Graph compiled successfully');
    console.log(`   - Graph nodes: ${Object.keys(deepResearcher.nodes).length}\n`);

    // Test state annotations
    console.log('3. Testing state annotations...');
    const { AgentStateAnnotation, SupervisorStateAnnotation, ResearcherStateAnnotation } = await import('./src/state');
    console.log('✅ State annotations created successfully');
    console.log(`   - Agent state fields: ${Object.keys(AgentStateAnnotation.spec).length}`);
    console.log(`   - Supervisor state fields: ${Object.keys(SupervisorStateAnnotation.spec).length}`);
    console.log(`   - Researcher state fields: ${Object.keys(ResearcherStateAnnotation.spec).length}\n`);

    // Test utility functions
    console.log('4. Testing utility functions...');
    const { getTodayStr, getModelTokenLimit } = await import('./src/utils');
    const today = getTodayStr();
    const tokenLimit = getModelTokenLimit('gpt-4o-mini');
    console.log('✅ Utility functions working');
    console.log(`   - Today: ${today}`);
    console.log(`   - GPT-4o-mini token limit: ${tokenLimit}\n`);

    console.log('🎉 All basic functionality tests passed!');
    console.log('\n📝 Next steps:');
    console.log('   1. Copy env.example to .env and add your API keys');
    console.log('   2. Run: pnpm dev');
    console.log('   3. Test with a research query');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testBasicFunctionality(); 