import type { ActiveValues, ControlSchema } from "../../lib/liquid/types";

export const ANALYST_SYSTEM_PROMPT = `You are a latent variable extractor. Your job is to decompose the provided text into its hidden control dimensions — the underlying axes of variation that, if altered, would meaningfully transform the text.

Output ONLY valid JSON that matches the provided schema.

Rules:
- Exactly 3 to 5 scalars
- Exactly 2 to 3 toggles
- Names MUST be specific to this exact text
- FORBIDDEN labels: Tone, Length, Formality, Clarity, Detail, Complexity, Style, Sentiment, Register, Politeness
- GOOD examples for a breakup text: Blame Assignment, Passive Aggressive, Closure Velocity, Door Left Open
- GOOD examples for code: Comment Density, Junior vs Senior Dev, Optimization Aggression, Magic Number Tolerance
- GOOD examples for an email: Corporate Buzzword Density, Urgency Escalation, Plausible Deniability, Enthusiasm Sincerity
- Each scalar should clearly map 0 and 100 to opposite extremes
- The default value reflects where the source text currently sits on that axis
- Toggle defaults are true only when the feature is currently present in the text`;

export function buildRewritePrompt(
  inputText: string,
  controls: ControlSchema,
  activeValues: ActiveValues,
) {
  const scalarLines = controls.scalars
    .map((scalar) => {
      const value =
        typeof activeValues[scalar.id] === "number"
          ? (activeValues[scalar.id] as number)
          : scalar.default;

      return `- ${scalar.label}: ${value}% — ${scalar.description}`;
    })
    .join("\n");

  const enabledToggles = controls.toggles
    .filter((toggle) => activeValues[toggle.id] === true)
    .map((toggle) => `- ${toggle.label}: ON — ${toggle.description}`)
    .join("\n");

  const disabledToggles = controls.toggles
    .filter((toggle) => activeValues[toggle.id] !== true)
    .map((toggle) => `- ${toggle.label}: OFF`)
    .join("\n");

  return [
    "Rewrite the text below.",
    "Apply each parameter exactly as specified.",
    "For scalars: 0% means minimum/none of that quality, 100% means maximum/extreme.",
    "",
    "Parameters:",
    scalarLines,
    enabledToggles ? `\nEnabled features:\n${enabledToggles}` : "",
    disabledToggles ? `\nDisabled features:\n${disabledToggles}` : "",
    "",
    "Return ONLY the rewritten text.",
    "Do not add commentary, prefixes, or quotes.",
    "Keep the output the same type of content as the input.",
    "",
    "Original text:",
    inputText,
  ]
    .filter(Boolean)
    .join("\n");
}
