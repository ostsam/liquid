import { z } from "zod";

import type { ActiveValues, ControlSchema } from "../../lib/liquid/types";

const FORBIDDEN_LABELS = new Set([
  "tone",
  "length",
  "formality",
  "clarity",
  "detail",
  "complexity",
  "style",
  "sentiment",
  "register",
  "politeness",
]);

const ControlLabelSchema = z
  .string()
  .min(1)
  .refine((value) => !FORBIDDEN_LABELS.has(value.trim().toLowerCase()), {
    message: "Control labels must be specific to the source text.",
  });

export const ScalarControlSchema = z.object({
  id: z.string().min(1),
  label: ControlLabelSchema,
  description: z.string().min(1),
  default: z.number().min(0).max(100),
});

export const ToggleControlSchema = z.object({
  id: z.string().min(1),
  label: ControlLabelSchema,
  description: z.string().min(1),
  default: z.boolean(),
});

export const ControlSchemaSchema = z
  .object({
    scalars: z.array(ScalarControlSchema).min(3).max(5),
    toggles: z.array(ToggleControlSchema).min(2).max(3),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    for (const control of [...value.scalars, ...value.toggles]) {
      if (seen.has(control.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate control id: ${control.id}`,
        });
      }

      seen.add(control.id);
    }
  });

export const AnalyzeRequestSchema = z.object({
  inputText: z.string().trim().min(1),
});

export const RewriteRequestSchema = z.object({
  inputText: z.string().trim().min(1),
  controls: ControlSchemaSchema,
  activeValues: z.record(z.union([z.number().min(0).max(100), z.boolean()])),
});

export const ControlSchemaJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scalars: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          default: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["id", "label", "description", "default"],
      },
    },
    toggles: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          default: { type: "boolean" },
        },
        required: ["id", "label", "description", "default"],
      },
    },
  },
  required: ["scalars", "toggles"],
} as const;

export function buildDefaultActiveValues(schema: ControlSchema): ActiveValues {
  const values: ActiveValues = {};

  for (const scalar of schema.scalars) {
    values[scalar.id] = scalar.default;
  }

  for (const toggle of schema.toggles) {
    values[toggle.id] = toggle.default;
  }

  return values;
}
