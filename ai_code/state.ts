import { z } from 'zod';
import { MessagesAnnotation, Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

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

// Type definitions
export type ConductResearch = z.infer<typeof ConductResearchSchema>;
export type ResearchComplete = z.infer<typeof ResearchCompleteSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type ClarifyWithUser = z.infer<typeof ClarifyWithUserSchema>;
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

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

// Input state annotation - only contains messages
export const AgentInputStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec
});

// Main agent state annotation
export const AgentStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  supervisorMessages: Annotation<BaseMessage[]>({
    reducer: overrideReducer,
    default: () => []
  }),
  researchBrief: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  }),
  rawNotes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  }),
  notes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  }),
  finalReport: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  })
});

// Supervisor state annotation
export const SupervisorStateAnnotation = Annotation.Root({
  supervisorMessages: Annotation<BaseMessage[]>({
    value: overrideReducer,
    default: () => []
  }),
  researchBrief: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  }),
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

// Researcher state annotation
export const ResearcherStateAnnotation = Annotation.Root({
  researcherMessages: Annotation<BaseMessage[]>({
    value: concatReducer,
    default: () => []
  }),
  toolCallIterations: Annotation<number>({
    value: overrideReducer,
    default: () => 0
  }),
  researchTopic: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  }),
  compressedResearch: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  }),
  rawNotes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  })
});

// Researcher output state annotation
export const ResearcherOutputStateAnnotation = Annotation.Root({
  compressedResearch: Annotation<string>({
    value: overrideReducer,
    default: () => ''
  }),
  rawNotes: Annotation<string[]>({
    value: concatReducer,
    default: () => []
  })
});

// Export type aliases for easier use
export type AgentInputState = typeof AgentInputStateAnnotation.State;
export type AgentState = typeof AgentStateAnnotation.State;
export type SupervisorState = typeof SupervisorStateAnnotation.State;
export type ResearcherState = typeof ResearcherStateAnnotation.State;
export type ResearcherOutputState = typeof ResearcherOutputStateAnnotation.State; 