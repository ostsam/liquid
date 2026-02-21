/**
 * Strategy 2: Semantic Cache — vector-based Analyst result cache
 *
 * The Analyst call (text → control schema) is expensive. This cache
 * embeds the input text and finds semantically similar past analyses
 * via cosine similarity. Two different breakup texts likely resolve
 * to the same control schema without touching Claude at all.
 *
 * Index: lc-analyst (Upstash Vector, dim=1536, cosine)
 * Threshold: 0.92 cosine similarity
 */

import { createHash } from "crypto";
import { vectorIndex } from "./client";
import type { ControlSchema } from "../types";

const SIMILARITY_THRESHOLD = 0.92;

export async function findSimilarSchema(
  embedding: number[]
): Promise<ControlSchema | null> {
  try {
    const results = await vectorIndex.query({
      vector: embedding,
      topK: 1,
      includeMetadata: true,
    });

    const top = results[0];
    if (top && top.score >= SIMILARITY_THRESHOLD && top.metadata) {
      const schemaStr = (top.metadata as Record<string, string>).schema;
      if (schemaStr) {
        return JSON.parse(schemaStr) as ControlSchema;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function storeSchema(
  inputText: string,
  embedding: number[],
  schema: ControlSchema
): Promise<void> {
  try {
    const id = createHash("sha256").update(inputText).digest("hex");
    await vectorIndex.upsert({
      id,
      vector: embedding,
      metadata: {
        schema: JSON.stringify(schema),
        preview: inputText.slice(0, 100),
      },
    });
  } catch {
    // Non-critical — silently ignore cache write failures
  }
}
