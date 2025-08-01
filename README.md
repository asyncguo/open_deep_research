# Open Deep Research

> 本项目 fork langchain 团队的 [open_deep_research](https://github.com/langchain-ai/open_deep_research) 项目。

一个基于 LangGraph 和 LangChain 构建的智能深度研究代理系统，能够自动进行多维度、多层次的深度研究，并生成高质量的研究报告。

## 🚀 项目概述

Open Deep Research 是一个先进的 AI 驱动研究系统，它通过多智能体协作的方式，自动执行从问题澄清到最终报告生成的完整研究流程。系统采用 LangGraph 框架构建，支持多种 AI 模型和搜索 API，能够处理复杂的研究任务。

## ✨ 核心特性

### 🔍 智能研究流程
- **问题澄清**: 自动分析用户输入，必要时请求澄清以确保研究方向的准确性
- **研究规划**: 将用户需求转化为详细的研究大纲
- **多智能体协作**: 通过监督者和研究者智能体的协作完成研究任务
- **信息压缩**: 智能压缩和整理研究过程中收集的信息
- **报告生成**: 自动生成结构化的最终研究报告


## 🚀 快速开始

### 环境要求

- Node.js 20+
- pnpm (推荐) 或 npm

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/asyncguo/open_deep_research
cd open_deep_research

# 安装依赖
pnpm install
```

### 环境配置

创建 `.env` 文件并配置必要的 API 密钥：

```env
# DeepSeek API 配置
DEEPSEEK_API_KEY=your_deepseek_api_key

# Tavily API 配置 (可选)
TAVILY_API_KEY=your_tavily_api_key
```

### 启动开发服务器

```bash
# 启动 LangGraph 开发服务器
pnpm dev
```
