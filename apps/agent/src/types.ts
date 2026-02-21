import { z } from "zod";

export const ScalarControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  default: z.number().min(0).max(100),
});

export const ToggleControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  default: z.boolean(),
});

export const ControlSchemaSchema = z.object({
  scalars: z.array(ScalarControlSchema).min(3).max(5),
  toggles: z.array(ToggleControlSchema).min(2).max(3),
});

export type ScalarControl = z.infer<typeof ScalarControlSchema>;
export type ToggleControl = z.infer<typeof ToggleControlSchema>;
export type ControlSchema = z.infer<typeof ControlSchemaSchema>;

export type ActiveValues = Record<string, number | boolean>;

export type LiquidAgentState = {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  sessionId: string;
};
