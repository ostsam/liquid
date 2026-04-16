export interface ScalarControl {
  id: string;
  label: string;
  description: string;
  default: number;
}

export interface ToggleControl {
  id: string;
  label: string;
  description: string;
  default: boolean;
}

export interface ControlSchema {
  scalars: ScalarControl[];
  toggles: ToggleControl[];
}

export type ActiveValues = Record<string, number | boolean>;

export interface LiquidClientState {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  sessionId: string;
  createdAt?: string;
}

export interface LiquidSessionSnapshot {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  sessionId: string;
  rootSessionId?: string;
  parentSessionId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  deleted?: boolean;
}

export interface PersistedSessionPayload {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  rootSessionId: string;
  parentSessionId: string | null;
  createdAt: string;
}

export interface RewriteChange {
  controlId: string;
  value: number | boolean;
}

export interface SessionHistoryEntry {
  controlId: string;
  value: string;
  outputSnapshot: string;
  timestamp: string;
}

export interface RewritePayload {
  inputText: string;
  controls: ControlSchema;
  activeValues: ActiveValues;
}
