import { Annotation } from "@langchain/langgraph";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
import type { ControlSchema, ActiveValues } from "./types";

export const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  // Use Annotation<T> without options — matches the LangGraph starter pattern.
  // "last write wins" reducer; initial values come from useCoAgent's initialState.
  inputText:    Annotation<string>,
  controls:     Annotation<ControlSchema | null>,
  activeValues: Annotation<ActiveValues>,
  outputText:   Annotation<string>,
  sessionId:    Annotation<string>,
});

export type AgentState = typeof AgentStateAnnotation.State;
