import { BaseMessage, filterMessages, ToolMessage } from "@langchain/core/messages";
import { ChatDeepSeek } from "@langchain/deepseek";

export const createModel = (modelConfig: any) => {
  const { model, maxTokens, apiKey } = modelConfig;

  return new ChatDeepSeek({
    apiKey,
    modelName: "deepseek-chat",
    // maxTokens: maxTokens,
    temperature: 0,
  });
}

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

// Get notes from tool calls in messages
export function getNotesFromToolCalls(messages: BaseMessage[]): string[] {
  const toolMessages = filterMessages(messages, { includeTypes: ['tool'] }) as ToolMessage[];
  return toolMessages.map(msg => msg.content.toString());
}