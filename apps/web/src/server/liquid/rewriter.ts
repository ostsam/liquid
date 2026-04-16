import { generateText, streamText } from "./openai";
import { buildRewritePrompt } from "./prompts";
import { RewriteRequestSchema } from "./schema";

const REWRITER_MODEL = process.env.LIQUID_REWRITER_MODEL ?? "gpt-5.4-mini";

function buildRewriteMessages(parsed: ReturnType<typeof RewriteRequestSchema.parse>) {
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
    model: REWRITER_MODEL,
    input: buildRewriteMessages(parsed),
  });
}

export async function streamRewriteInput(args: unknown): Promise<ReadableStream<Uint8Array>> {
  const parsed = RewriteRequestSchema.parse(args);

  return streamText({
    model: REWRITER_MODEL,
    input: buildRewriteMessages(parsed),
  });
}
