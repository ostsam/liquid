import { generateText, streamText } from "./openai";
import { buildRewritePrompt } from "./prompts";
import { RewriteRequestSchema } from "./schema";
import { AI_MODEL } from "./prompts";

function buildRewriteMessages(
	parsed: ReturnType<typeof RewriteRequestSchema.parse>,
) {
	return [
		{
			role: "system" as const,
			content:
				"Rewrite the user's text according to the provided controls. Return only the rewritten text.",
		},
		{
			role: "user" as const,
			content: buildRewritePrompt(
				parsed.inputText,
				parsed.controls,
				parsed.activeValues,
			),
		},
	];
}

export async function rewriteInput(args: unknown) {
	const parsed = RewriteRequestSchema.parse(args);

	return generateText({
		model: AI_MODEL,
		input: buildRewriteMessages(parsed),
	});
}

export async function streamRewriteInput(
	args: unknown,
): Promise<ReadableStream<Uint8Array>> {
	const parsed = RewriteRequestSchema.parse(args);

	return streamText({
		model: AI_MODEL,
		input: buildRewriteMessages(parsed),
	});
}
