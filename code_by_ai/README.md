# Open Deep Research JS

TypeScript/JavaScript implementation of the Open Deep Research system using LangGraph JS.

## Overview

This is a multi-agent research system that can conduct comprehensive research on any topic using various search APIs and AI models. The system follows a supervisor-researcher architecture where a lead researcher coordinates multiple specialized research agents.

## Features

- 🔍 **Multi-Search Integration**: Supports Tavily, OpenAI, and Anthropic search APIs
- 🤖 **Multi-Agent Architecture**: Supervisor-researcher pattern for efficient research
- 📊 **Structured Research Flow**: User clarification → Research brief → Research execution → Final report
- 💾 **Persistent Memory**: LangGraph checkpointing for resumable research sessions
- 🛠️ **Tool Integration**: Extensible tool system with MCP support
- 📝 **Comprehensive Reports**: Well-structured final reports with citations

## Architecture

The system consists of several key components:

1. **Configuration Management** (`config.ts`) - Handles all system configuration
2. **State Management** (`state.ts`) - Defines graph states and data schemas
3. **Core Research Engine** (`deepResearcher.ts`) - Main LangGraph workflow
4. **Utility Functions** (`utils.ts`) - Search tools and helper functions
5. **Prompts** (`prompts.ts`) - AI prompts for different research phases

## Installation

```bash
# Clone and setup
git clone <repository>
cd open_deep_research_js

# Install dependencies using pnpm
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your API keys
```

## Environment Variables

Required environment variables:

```bash
# At least one LLM API key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Search API (Tavily recommended)
TAVILY_API_KEY=your_tavily_api_key

# Optional configurations
SEARCH_API=tavily
RESEARCH_MODEL=openai:gpt-4o
MAX_CONCURRENT_RESEARCH_UNITS=5
```

## Usage

### Local Development

```bash
# Build the project
pnpm build

# Run a research query
pnpm start "What are the latest developments in quantum computing?"

# Development mode
pnpm dev "Research topic here"
```

### LangGraph Platform Deployment

1. Ensure `langgraph.json` is properly configured
2. Deploy using LangGraph CLI:

```bash
# Deploy to LangGraph platform
langgraph deploy
```

### Programmatic Usage

```typescript
import { deepResearcher } from './src/index.js';
import { HumanMessage } from '@langchain/core/messages';

async function runResearch() {
  const result = await deepResearcher.invoke({
    messages: [new HumanMessage("Research quantum computing breakthroughs")]
  }, {
    configurable: {
      thread_id: "my-research-session"
    }
  });
  
  console.log(result.finalReport);
}
```

## Configuration Options

The system can be configured through environment variables or programmatically:

```typescript
import { ConfigurationManager } from './src/config.js';

const config = new ConfigurationManager({
  searchApi: SearchAPI.TAVILY,
  maxConcurrentResearchUnits: 3,
  researchModel: 'anthropic:claude-3-5-sonnet'
});
```

### Available Models

- **OpenAI**: `openai:gpt-4o`, `openai:gpt-4o-mini`, `openai:gpt-4-turbo`
- **Anthropic**: `anthropic:claude-3-5-sonnet`, `anthropic:claude-3-5-haiku`
- **Google**: `google:gemini-1.5-pro`, `google:gemini-1.5-flash`

### Search APIs

- **Tavily** (Recommended): High-quality search with content extraction
- **OpenAI**: Native web search integration
- **Anthropic**: Native web search integration

## Research Flow

1. **User Clarification**: Optionally clarifies ambiguous research requests
2. **Research Brief Generation**: Creates detailed research plan
3. **Research Supervision**: Coordinates multiple research tasks
4. **Research Execution**: Uses tools to gather information
5. **Report Generation**: Synthesizes findings into comprehensive report

## Development

```bash
# Install dependencies
pnpm install

# Type checking
pnpm type-check

# Linting
pnpm lint

# Build
pnpm build

# Run tests
pnpm test
```

## Architecture Comparison

This TypeScript implementation maintains feature parity with the Python version while leveraging JavaScript/Node.js ecosystem:

| Feature | Python Version | TypeScript Version |
|---------|----------------|-------------------|
| LangGraph | ✅ Python LangGraph | ✅ LangGraph JS |
| State Management | Pydantic | Zod + TypeScript |
| Multi-Agent | ✅ | ✅ |
| Search APIs | ✅ | ✅ |
| MCP Tools | ✅ | 🚧 Planned |
| Checkpointing | ✅ | ✅ |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open a GitHub issue or refer to the LangGraph documentation. 