const OPENAI_URL = "https://api.openai.com/v1/responses";

type ResponseMessage = {
  type?: string;
  content?: Array<{ type?: string; text?: string; refusal?: string }>;
};

type ResponseBody = {
  output?: ResponseMessage[];
};

function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  return apiKey;
}

async function callOpenAI(body: object) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as ResponseBody;
}

function extractOutputText(response: ResponseBody) {
  const parts: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const contentPart of item.content ?? []) {
      if (contentPart.type === "output_text" && typeof contentPart.text === "string") {
        parts.push(contentPart.text);
      }
    }
  }

  return parts.join("").trim();
}

export async function generateStructuredText(args: {
  model: string;
  name: string;
  schema: object;
  input: Array<{ role: "system" | "user"; content: string }>;
}) {
  const response = await callOpenAI({
    model: args.model,
    input: args.input,
    text: {
      format: {
        type: "json_schema",
        name: args.name,
        strict: true,
        schema: args.schema,
      },
    },
  });

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("OpenAI returned no structured output text");
  }

  return outputText;
}

export async function generateText(args: {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
}) {
  const response = await callOpenAI({
    model: args.model,
    input: args.input,
  });

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("OpenAI returned no output text");
  }

  return outputText;
}

export async function streamText(args: {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = requireApiKey();

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      input: args.input,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("OpenAI returned no response body for streaming");
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string"
            ) {
              controller.enqueue(encoder.encode(event.delta));
            }
          } catch {
            // Skip malformed SSE data lines
          }
        }
      },
      flush(controller) {
        if (!buffer.trim()) return;
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string"
            ) {
              controller.enqueue(encoder.encode(event.delta));
            }
          } catch {}
        }
      },
    }),
  );
}
