/**
 * Analyst Node — text → ControlSchema
 *
 * Runs when inputText is set and controls is null.
 * Checks the semantic cache first (via Upstash Vector).
 * Falls back to Claude with a strict JSON prompt.
 * Validates output with Zod; retries once on schema failure.
 * Fires background warm-cache jobs after successful analysis.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { AgentState } from "../state";
import {
	ControlSchemaSchema,
	type ControlSchema,
	type ActiveValues,
} from "../types";
import { findSimilarSchema, storeSchema } from "../redis/semantic";
import { warmCache } from "../redis/timemachine";
import { updateSession } from "../redis/session";
import { callRewriter } from "./rewriter";

const ANALYST_SYSTEM_PROMPT = `You are a latent variable extractor. Your job is to decompose the provided text into its hidden control dimensions — the underlying axes of variation that, if altered, would meaningfully transform the text.

Output ONLY a JSON object. No explanation. No markdown. No code fences. Raw JSON only.

Schema:
{
  "scalars": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence describing what this dimension controls.", "default": 50 }
  ],
  "toggles": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence describing what flipping this changes.", "default": false }
  ]
}

Rules:
- Exactly 3 to 5 scalars (no more, no fewer)
- Exactly 2 to 3 toggles (no more, no fewer)
- Names MUST be specific to this exact text. Generic names are strictly forbidden.
- FORBIDDEN labels: "Tone", "Length", "Formality", "Clarity", "Detail", "Complexity", "Style", "Sentiment", "Register", "Politeness"
- REQUIRED: Names that reveal something surprising or specific about THIS piece of text
- GOOD examples for a breakup text: "Blame Assignment", "Passive Aggressive", "Closure Velocity", "Door Left Open"
- GOOD examples for code: "Comment Density", "Junior vs Senior Dev", "Optimization Aggression", "Magic Number Tolerance"
- GOOD examples for an email: "Corporate Buzzword Density", "Urgency Escalation", "Plausible Deniability", "Enthusiasm Sincerity"
- Each scalar: at value 0 the text transforms dramatically one way; at value 100 it transforms the opposite extreme
- The "default" value (0-100) reflects exactly where THIS text currently sits on that dimension
- Toggle defaults: true if the feature is actively present in the current text, false if absent`;

function buildDefaultActiveValues(schema: ControlSchema): ActiveValues {
	const values: ActiveValues = {};
	for (const scalar of schema.scalars) values[scalar.id] = scalar.default;
	for (const toggle of schema.toggles) values[toggle.id] = toggle.default;
	return values;
}

export async function analystNode(
	state: AgentState,
	config: RunnableConfig,
): Promise<Partial<AgentState>> {
	if (!state.inputText) return {};

	// Step 1: Embed the input for semantic cache lookup
	let embedding: number[] = [];
	try {
		const embeddings = new OpenAIEmbeddings({
			model: "text-embedding-3-small",
		});
		embedding = await embeddings.embedQuery(state.inputText);

		// Step 2: Check semantic cache
		const cached = await findSimilarSchema(embedding);
		if (cached) {
			console.log("[analyst] Semantic cache hit — skipping Claude call");
			const activeValues = buildDefaultActiveValues(cached);

			// Fire warm cache for this new content hash (non-blocking)
			warmCache(state.inputText, cached, (values) =>
				callRewriter(state.inputText, cached, values),
			).catch(() => {});

			return { controls: cached, activeValues };
		}
	} catch (err) {
		console.warn("[analyst] Embedding/semantic cache failed:", err);
	}

	// Step 3: Call Claude — up to 2 attempts
	const model = new ChatAnthropic({
		model: "claude-haiku-4-5",
		temperature: 1,
	});

	let controls: ControlSchema | null = null;

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const userContent =
				attempt === 0
					? state.inputText
					: `${state.inputText}\n\n[IMPORTANT: Your previous response failed JSON validation. Output ONLY raw JSON — no markdown fences, no explanation, no prefix text.]`;

			const response = await model.invoke(
				[
					new SystemMessage(ANALYST_SYSTEM_PROMPT),
					new HumanMessage(userContent),
				],
				config,
			);

			const raw =
				typeof response.content === "string"
					? response.content
					: (response.content as Array<{ text?: string }>)
							.map((b) => b.text ?? "")
							.join("");

			// Strip markdown code fences if Claude adds them despite instructions
			const clean = raw
				.replace(/^```(?:json)?\s*/i, "")
				.replace(/\s*```$/i, "")
				.trim();

			const parsed = JSON.parse(clean);
			controls = ControlSchemaSchema.parse(parsed);
			break;
		} catch (err) {
			console.warn(`[analyst] Attempt ${attempt + 1}/2 failed:`, err);
		}
	}

	if (!controls) {
		console.error(
			"[analyst] Failed to produce valid ControlSchema after 2 attempts",
		);
		return {};
	}

	// Step 4: Store in semantic cache (non-blocking)
	if (embedding.length > 0) {
		storeSchema(state.inputText, embedding, controls).catch(() => {});
	}

	// Step 5: Fire warm cache in background (non-blocking)
	warmCache(state.inputText, controls, (values) =>
		callRewriter(state.inputText, controls!, values),
	).catch(() => {});

	const activeValues = buildDefaultActiveValues(controls);

	// Persist controls + activeValues so page refresh can restore the full cockpit
	if (state.sessionId) {
		void updateSession(state.sessionId, { ...state, controls, activeValues });
	}

	return { controls, activeValues };
}
