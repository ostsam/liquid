import type {
  ActiveValues,
  ControlSchema,
  LiquidClientState,
  LiquidSessionSnapshot,
  PersistedSessionPayload,
  RewriteChange,
  SessionHistoryEntry,
} from "./types";

export function makeSessionId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

export function hydrateClientState(
  session: Partial<LiquidSessionSnapshot>,
  sessionId: string,
): LiquidClientState {
  return {
    inputText: session.inputText ?? "",
    controls: session.controls ?? null,
    activeValues: session.activeValues ?? {},
    outputText: session.outputText ?? "",
    sessionId,
    createdAt: session.createdAt,
  };
}

export function buildInitialSessionPayload(inputText: string): PersistedSessionPayload {
  return {
    inputText,
    controls: null,
    activeValues: {},
    outputText: "",
    rootSessionId: "",
    parentSessionId: null,
    createdAt: Date.now().toString(),
  };
}

export function buildSessionPayload(args: {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  rootSessionId: string;
  parentSessionId: string | null;
  createdAt?: string;
}): PersistedSessionPayload {
  return {
    inputText: args.inputText,
    controls: args.controls,
    activeValues: args.activeValues,
    outputText: args.outputText,
    rootSessionId: args.rootSessionId,
    parentSessionId: args.parentSessionId,
    createdAt: args.createdAt ?? Date.now().toString(),
  };
}

export function buildCommittedRewriteArtifacts(args: {
  currentSessionId: string;
  rootSessionId: string;
  inputText: string;
  controls: ControlSchema;
  activeValues: ActiveValues;
  outputText: string;
  isInitialCommit: boolean;
  change: RewriteChange | null;
  currentCreatedAt?: string;
  makeId?: () => string;
  now?: number;
}): {
  nextSessionId: string;
  historySessionId: string;
  sessionPayload: PersistedSessionPayload;
  historyEntry: SessionHistoryEntry;
} {
  const timestamp = String(args.now ?? Date.now());
  const nextSessionId = args.isInitialCommit
    ? args.currentSessionId
    : (args.makeId ?? makeSessionId)();

  return {
    nextSessionId,
    historySessionId: args.rootSessionId,
    sessionPayload: {
      inputText: args.inputText,
      controls: args.controls,
      activeValues: args.activeValues,
      outputText: args.outputText,
      rootSessionId: args.rootSessionId,
      parentSessionId: args.isInitialCommit ? null : args.currentSessionId,
      createdAt: args.isInitialCommit ? args.currentCreatedAt ?? timestamp : timestamp,
    },
    historyEntry: {
      controlId: args.change?.controlId ?? "__initial__",
      value: String(args.change?.value ?? "initial"),
      outputSnapshot: args.outputText,
      timestamp,
    },
  };
}
