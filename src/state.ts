import { BaseMessage } from "@langchain/core/messages";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { z } from "zod";

// Structured output schemas for tool calling
export const ConductResearchSchema = z.object({
  researchTopic: z.string().describe(
    'The topic to research. Should be a single topic, and should be described in high detail (at least a paragraph).'
  )
});

export const ResearchCompleteSchema = z.object({
  completed: z.boolean().describe('Whether the research is complete')
});

export const SummarySchema = z.object({
  summary: z.string(),
  keyExcerpts: z.string()
});

export const ClarifyWithUserSchema = z.object({
  needClarification: z.boolean().describe(
    'Whether the user needs to be asked a clarifying question.'
  ),
  question: z.string().describe(
    'A question to ask the user to clarify the report scope'
  ),
  verification: z.string().describe(
    'Verify message that we will start research after the user has provided the necessary information.'
  )
});

export const ResearchQuestionSchema = z.object({
  researchBrief: z.string().describe(
    'A research question that will be used to guide the research.'
  )
});

// Custom reducer for overriding arrays and objects
export function overrideReducer<T>(currentValue: T, newValue: T): T {
  if (typeof newValue === 'object' && newValue !== null && 'type' in newValue && (newValue as any).type === 'override') {
    return (newValue as any).value ?? newValue;
  }
  return newValue;
}

// Custom reducer for concatenating arrays
export function concatReducer<T>(currentValue: T[], newValue: T[]): T[] {
  if (Array.isArray(currentValue) && Array.isArray(newValue)) {
    return currentValue.concat(newValue);
  }
  return newValue;
}

// Main agent state annotation
export const AgentStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  supervisorMessages: Annotation<BaseMessage[]>({
    value: overrideReducer,
    default: () => []
  }),
  researchBrief: Annotation<string>,

  finalReport: Annotation<string>
})

// Supervisor state annotation
export const SupervisorStateAnnotation = Annotation.Root({
  supervisorMessages: Annotation<BaseMessage[]>({
    value: overrideReducer,
    default: () => []
  }),
  researchBrief: Annotation<string>,
  notes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  }),
  researchIterations: Annotation<number>({
    value: overrideReducer,
    default: () => 0
  }),
  rawNotes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  })
});

// Export type aliases for easier use
export type AgentState = typeof AgentStateAnnotation.State;
export type SupervisorState = typeof SupervisorStateAnnotation.State;
