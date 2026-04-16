import type { ControlSchema } from "../../lib/liquid/types";

import {
  AnalyzeRequestSchema,
  buildDefaultActiveValues,
  ControlSchemaJsonSchema,
  ControlSchemaSchema,
} from "./schema";
import { ANALYST_SYSTEM_PROMPT } from "./prompts";
import { generateStructuredText } from "./openai";

const ANALYST_MODEL = process.env.LIQUID_ANALYST_MODEL ?? "gpt-5.4";

export async function analyzeInput(inputText: string) {
  const parsed = AnalyzeRequestSchema.parse({ inputText });
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await generateStructuredText({
        model: ANALYST_MODEL,
        name: "liquid_control_schema",
        schema: ControlSchemaJsonSchema,
        input: [
          { role: "system", content: ANALYST_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              attempt === 0
                ? parsed.inputText
                : `${parsed.inputText}\n\nRetry with strict JSON that matches the provided schema exactly.`,
          },
        ],
      });

      const controls = ControlSchemaSchema.parse(
        JSON.parse(raw) as ControlSchema,
      );

      return {
        controls,
        activeValues: buildDefaultActiveValues(controls),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to analyze input");
}
