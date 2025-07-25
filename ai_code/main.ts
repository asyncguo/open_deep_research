import { HumanMessage } from "@langchain/core/messages";
import { deepResearcher } from "./deepResearcher";

const main = async () => {
  try {
    // Validate configuration
    // const configManager = new ConfigurationManager();
    // configManager.validateRequiredApiKeys();
    
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
        messages: [new HumanMessage('如何在 react 中使用 vue 组件')]
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

main()
