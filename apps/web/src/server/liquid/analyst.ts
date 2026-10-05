import type { ControlSchema } from "../../lib/liquid/types";

import {
	AnalyzeRequestSchema,
	buildDefaultActiveValues,
	ControlSchemaJsonSchema,
	ControlSchemaSchema,
} from "./schema";
import { ANALYST_SYSTEM_PROMPT } from "./prompts";
import { generateStructuredText } from "./openai";
import { AI_MODEL } from "./prompts";

export async function analyzeInput(inputText: string) {
	const parsed = AnalyzeRequestSchema.parse({ inputText });
	let lastError: unknown;

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const raw = await generateStructuredText({
				model: AI_MODEL,
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
