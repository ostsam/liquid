/**
 * Strategy 3: Sculpting History — Redis Streams
 *
 * Every control change is appended as an event to a Redis Stream.
 * This is the "DNA" of the editing session — a complete event log.
 * Powers the Replay feature: scrub back through every decision
 * the user made, replaying text morphs without any LLM calls.
 *
 * Key: lc:session:{sessionId}:history (TTL: 24h)
 * Entry: { controlId, value, outputSnapshot, timestamp }
 */

import { redis } from "./client";

export interface HistoryEntry {
  id: string;
  controlId: string;
  value: string;
  outputSnapshot: string;
  timestamp: string;
}

export async function appendEvent(
  sessionId: string,
  controlId: string,
  value: string,
  outputSnapshot: string
): Promise<void> {
  try {
    const key = `lc:session:${sessionId}:history`;
    await redis.xadd(key, "*", {
      controlId,
      value,
      outputSnapshot,
      timestamp: Date.now().toString(),
    });
    // Set TTL on first entry (subsequent calls are no-ops if already set)
    await redis.expire(key, 86400);
  } catch {
    // Non-critical
  }
}

export async function getHistory(sessionId: string): Promise<HistoryEntry[]> {
  try {
    const key = `lc:session:${sessionId}:history`;
    // xrange returns Record<streamId, Record<field, value>> in @upstash/redis
    const raw = await redis.xrange(key, "-", "+");
    if (!raw) return [];

    return Object.entries(raw as Record<string, Record<string, unknown>>).map(
      ([id, message]) => ({
        id,
        controlId: String(message["controlId"] ?? ""),
        value: String(message["value"] ?? ""),
        outputSnapshot: String(message["outputSnapshot"] ?? ""),
        timestamp: String(message["timestamp"] ?? ""),
      })
    );
  } catch {
    return [];
  }
}
