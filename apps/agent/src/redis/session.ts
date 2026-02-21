/**
 * Strategy 4: Session Store + Shareable URLs — Redis Hash
 *
 * Stores the full session state (input, controls, active values,
 * output) in a Redis Hash. Generates a short URL-safe ID.
 * Powers collaboration (a second user loading the URL sees the
 * exact same cockpit) and session hydration on page reload.
 *
 * Key: lc:session:{sessionId} (TTL: 24h)
 */

import { redis } from "./client";
import type { LiquidAgentState } from "../types";

const TTL = 86400; // 24 hours

export async function createSession(
  state: Partial<LiquidAgentState>
): Promise<string> {
  const { randomBytes } = await import("crypto");
  const sessionId = randomBytes(6).toString("base64url");
  await updateSession(sessionId, state);
  return sessionId;
}

export async function updateSession(
  sessionId: string,
  state: Partial<LiquidAgentState>
): Promise<void> {
  try {
    const key = `lc:session:${sessionId}`;
    await redis.hset(key, {
      inputText: state.inputText ?? "",
      controlsJson: JSON.stringify(state.controls ?? null),
      activeValuesJson: JSON.stringify(state.activeValues ?? {}),
      outputText: state.outputText ?? "",
      updatedAt: Date.now().toString(),
    });
    await redis.expire(key, TTL);
  } catch {
    // Non-critical
  }
}

export async function getSession(
  sessionId: string
): Promise<LiquidAgentState | null> {
  try {
    const key = `lc:session:${sessionId}`;
    const raw = await redis.hgetall<Record<string, string>>(key);
    if (!raw || !raw.inputText) return null;

    return {
      inputText: raw.inputText ?? "",
      controls: raw.controlsJson ? JSON.parse(raw.controlsJson) : null,
      activeValues: raw.activeValuesJson ? JSON.parse(raw.activeValuesJson) : {},
      outputText: raw.outputText ?? "",
      sessionId,
    };
  } catch {
    return null;
  }
}
