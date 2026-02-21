/**
 * GET    /api/session/[id]  — return session state from Redis
 * POST   /api/session/[id]  — upsert session state to Redis
 * DELETE /api/session/[id]  — soft-delete (marks deleted: "true")
 *
 * The web app maintains its own Redis client (same credentials, separate instance
 * from apps/agent). Do not import from apps/agent.
 */

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TTL = 86400; // 24h

// Upstash REST client auto-deserializes JSON values from hashes, so a field
// stored as a JSON string may arrive already parsed. Handle both cases.
function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = await redis.hgetall<Record<string, unknown>>(
      `lc:session:${id}`
    );

    if (!raw) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      inputText: raw.inputText ?? "",
      controls: raw.controlsJson ? safeParseJson(raw.controlsJson, null) : null,
      activeValues: safeParseJson(raw.activeValuesJson, {}),
      outputText: raw.outputText ?? "",
      sessionId: id,
      updatedAt: raw.updatedAt ?? "0",
      createdAt: raw.createdAt ?? raw.updatedAt ?? "0",
      rootSessionId: raw.rootSessionId ?? id,
      parentSessionId: raw.parentSessionId ?? null,
      deleted: raw.deleted === "true",
    });
  } catch (err) {
    console.error("[session GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const rootId: string = body.rootSessionId ?? id;

    await redis.hset(`lc:session:${id}`, {
      inputText: body.inputText ?? "",
      controlsJson: JSON.stringify(body.controls ?? null),
      activeValuesJson: JSON.stringify(body.activeValues ?? {}),
      outputText: body.outputText ?? "",
      updatedAt: Date.now().toString(),
      createdAt: body.createdAt ?? Date.now().toString(),
      rootSessionId: rootId,
      parentSessionId: body.parentSessionId ?? "",
    });
    await redis.expire(`lc:session:${id}`, TTL);

    // Register in the tree set so /api/tree/[rootId] can enumerate all sessions
    await redis.sadd(`lc:tree:${rootId}:sessions`, id);
    await redis.expire(`lc:tree:${rootId}:sessions`, TTL);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[session POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await redis.hset(`lc:session:${id}`, { deleted: "true" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[session DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
