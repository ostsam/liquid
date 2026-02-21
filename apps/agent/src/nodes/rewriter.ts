/**
 * Rewriter Node — ControlSchema + ActiveValues → rewritten text
 *
 * Runs when activeValues changes (debounced 300ms on the frontend).
 * Checks the KV pre-generation cache first; falls back to Claude.
 * Stores result in KV cache, appends to sculpting history stream,
 * and updates the session hash.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { copilotkitEmitState } from "@copilotkit/sdk-js/langgraph";
import type { AgentState } from "../state";
import type { ControlSchema, ActiveValues } from "../types";
import { getRewrite, setRewrite } from "../redis/timemachine";
import { appendEvent } from "../redis/streams";
import { updateSession } from "../redis/session";

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
	inputText: string,
	controls: ControlSchema,
	activeValues: ActiveValues,
): string {
	const scalarLines = controls.scalars
		.map((s) => {
			const val =
				typeof activeValues[s.id] === "number"
					? (activeValues[s.id] as number)
					: s.default;
			return `- ${s.label}: ${val}% — ${s.description}`;
		})
		.join("\n");

	const enabledToggles = controls.toggles
		.filter((t) => activeValues[t.id] === true)
		.map((t) => `- ${t.label}: ON — ${t.description}`)
		.join("\n");

	const disabledToggles = controls.toggles
		.filter((t) => activeValues[t.id] !== true)
		.map((t) => `- ${t.label}: OFF`)
		.join("\n");

	return [
		"Rewrite the text below. Apply each parameter exactly as specified.",
		"For scalars: 0% = none/minimum of that quality; 100% = maximum/extreme.",
		"",
		"Parameters:",
		scalarLines,
		enabledToggles ? `\nEnabled features:\n${enabledToggles}` : "",
		disabledToggles ? `\nDisabled features:\n${disabledToggles}` : "",
		"",
		"Return ONLY the rewritten text — no explanation, no quotes, no prefix.",
		"The output must be the same type of content as the input.",
		"",
		"Original text:",
		inputText,
	]
		.filter((l) => l !== undefined)
		.join("\n");
}

// ─── Core rewrite function (used by both the node and the warm cache) ────────

export async function callRewriter(
	inputText: string,
	controls: ControlSchema,
	activeValues: ActiveValues,
): Promise<string> {
	const model = new ChatAnthropic({
		model: "claude-haiku-4-5",
		temperature: 0.7,
	});

	const prompt = buildPrompt(inputText, controls, activeValues);
	const response = await model.invoke([new HumanMessage(prompt)]);

	return typeof response.content === "string"
		? response.content
		: (response.content as Array<{ text?: string }>)
				.map((b) => b.text ?? "")
				.join("");
}

// ─── LangGraph node ──────────────────────────────────────────────────────────

export async function rewriterNode(
	state: AgentState,
	config: RunnableConfig,
): Promise<Partial<AgentState>> {
	if (
		!state.inputText ||
		!state.controls ||
		Object.keys(state.activeValues ?? {}).length === 0
	) {
		return {};
	}

	// Step 1: Check KV pre-generation cache
	try {
		const cached = await getRewrite(state.inputText, state.activeValues);
		if (cached) {
			console.log("[rewriter] KV cache hit");
			if (state.sessionId) {
				void appendEvent(state.sessionId, "__cached__", "hit", cached);
				void updateSession(state.sessionId, { ...state, outputText: cached });
			}
			return { outputText: cached };
		}
	} catch {
		// Fall through to live call
	}

	// Step 2: Stream from Claude, emitting partial outputText on each chunk
	const model = new ChatAnthropic({ model: "claude-haiku-4-5", temperature: 0.7 });
	const prompt = buildPrompt(state.inputText, state.controls, state.activeValues);
	const stream = await model.stream([new HumanMessage(prompt)]);

	let outputText = "";
	for await (const chunk of stream) {
		const delta =
			typeof chunk.content === "string"
				? chunk.content
				: (chunk.content as Array<{ text?: string }>)
						.map((b) => b.text ?? "")
						.join("");
		outputText += delta;
		await copilotkitEmitState(config, { ...state, outputText });
	}

	// Step 3: Cache result (non-blocking)
	void setRewrite(state.inputText, state.activeValues, outputText);

	// Step 4: Append to sculpting history stream (non-blocking)
	if (state.sessionId) {
		// Best-effort: record which control was most recently changed
		const changedId = Object.keys(state.activeValues)[0] ?? "unknown";
		const changedVal = String(state.activeValues[changedId] ?? "");
		void appendEvent(state.sessionId, changedId, changedVal, outputText);
		void updateSession(state.sessionId, { ...state, outputText });
	}

	return { outputText };
}
