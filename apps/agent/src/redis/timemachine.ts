/**
 * Strategy 1: Pre-generation KV Cache — the "Time Machine"
 *
 * Eliminates slider latency by speculatively computing outputs
 * before the user drags. On first load, fires N×3 background
 * rewrite jobs for every scalar at {0, 50, 100} and all toggle
 * permutations (capped at 8). Cache hit target: >80% after 5s.
 *
 * Key schema: lc:v:{contentHash}:{paramHash} → rewritten_text (TTL: 1h)
 */

import { createHash } from "crypto";
import { redis } from "./client";
import type { ControlSchema, ActiveValues } from "../types";

const TTL = 3600; // 1 hour

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Quantize a slider value to the nearest 10 for broad cache coverage */
export function quantize(value: number): number {
  return Math.round(value / 10) * 10;
}

function buildKey(inputText: string, activeValues: ActiveValues): string {
  const contentHash = sha256(inputText);
  // Sort keys for deterministic hashing
  const sorted = Object.fromEntries(
    Object.entries(activeValues).sort(([a], [b]) => a.localeCompare(b))
  );
  const paramHash = sha256(JSON.stringify(sorted));
  return `lc:v:${contentHash}:${paramHash}`;
}

function quantizeValues(activeValues: ActiveValues): ActiveValues {
  const out: ActiveValues = {};
  for (const [id, val] of Object.entries(activeValues)) {
    if (typeof val === "number") {
      out[id] = quantize(val);
    } else {
      out[id] = val;
    }
  }
  return out;
}

export async function getRewrite(
  inputText: string,
  activeValues: ActiveValues
): Promise<string | null> {
  try {
    const quantized = quantizeValues(activeValues);
    const key = buildKey(inputText, quantized);
    const cached = await redis.get<string>(key);
    return cached ?? null;
  } catch {
    return null;
  }
}

export async function setRewrite(
  inputText: string,
  activeValues: ActiveValues,
  output: string
): Promise<void> {
  try {
    const quantized = quantizeValues(activeValues);
    const key = buildKey(inputText, quantized);
    await redis.set(key, output, { ex: TTL });
  } catch {
    // Non-critical — silently ignore cache write failures
  }
}

/**
 * Fire background pre-generation jobs after controls first appear.
 * Generates N×3 single-axis extremes for scalars + all toggle combos.
 */
export async function warmCache(
  inputText: string,
  controls: ControlSchema,
  rewriteFn: (values: ActiveValues) => Promise<string>
): Promise<void> {
  const defaultValues: ActiveValues = {};
  for (const s of controls.scalars) defaultValues[s.id] = s.default;
  for (const t of controls.toggles) defaultValues[t.id] = t.default;

  const jobs: Array<() => Promise<void>> = [];

  // Single-axis extremes: each scalar at 0, 50, 100 with others at default
  for (const scalar of controls.scalars) {
    for (const target of [0, 50, 100]) {
      const values: ActiveValues = { ...defaultValues, [scalar.id]: target };
      jobs.push(async () => {
        try {
          // Skip if already cached
          const existing = await getRewrite(inputText, values);
          if (existing) return;
          const output = await rewriteFn(values);
          await setRewrite(inputText, values, output);
        } catch {
          // Warm cache failures are non-critical
        }
      });
    }
  }

  // All toggle combinations (capped at 8)
  const toggleIds = controls.toggles.map((t) => t.id);
  const comboCap = Math.min(Math.pow(2, toggleIds.length), 8);
  for (let i = 0; i < comboCap; i++) {
    const values: ActiveValues = { ...defaultValues };
    for (let bit = 0; bit < toggleIds.length; bit++) {
      values[toggleIds[bit]] = !!(i & (1 << bit));
    }
    jobs.push(async () => {
      try {
        const existing = await getRewrite(inputText, values);
        if (existing) return;
        const output = await rewriteFn(values);
        await setRewrite(inputText, values, output);
      } catch {
        // Non-critical
      }
    });
  }

  // Run all jobs concurrently (fire-and-forget from caller's perspective)
  await Promise.allSettled(jobs.map((j) => j()));
}
