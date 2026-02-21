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
      deleted: raw.deleted === "true" || raw.deleted === true,
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

/**
 * PATCH /api/session/[id]
 *
 * Updates only outputText + updatedAt. All other fields (parentSessionId,
 * rootSessionId, controlsJson, etc.) are preserved via Redis hash field-level write.
 * Used by the frontend to reliably persist the final streamed outputText with the
 * correct sessionId — bypassing any sessionId timing ambiguity in the Python agent.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { outputText } = await req.json();
    await redis.hset(`lc:session:${id}`, {
      outputText: outputText ?? "",
      updatedAt: Date.now().toString(),
    });
    await redis.expire(`lc:session:${id}`, TTL);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[session PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Look up rootSessionId so we can walk the full tree
    const sessionData = await redis.hgetall<Record<string, string>>(`lc:session:${id}`);
    const rootId = sessionData?.rootSessionId ?? id;

    // Fetch every session ID registered in this tree (null-safe: smembers returns null for missing keys)
    const allIds = (await redis.smembers<string[]>(`lc:tree:${rootId}:sessions`)) ?? [id];

    // Resolve parentSessionId for every session in one pipeline round-trip
    const parentPipeline = redis.pipeline();
    for (const sid of allIds) {
      parentPipeline.hget(`lc:session:${sid}`, "parentSessionId");
    }
    const parentResults = await parentPipeline.exec() as (string | null)[];

    // Build child-map: parentId → [childId, ...]
    const childMap = new Map<string, string[]>();
    allIds.forEach((sid, i) => {
      const parentId = parentResults[i];
      if (parentId) {
        const siblings = childMap.get(parentId) ?? [];
        siblings.push(sid);
        childMap.set(parentId, siblings);
      }
    });

    // BFS from the target node to collect it and all its descendants
    const toDelete = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childMap.get(current) ?? []) {
        if (!toDelete.has(child)) {
          toDelete.add(child);
          queue.push(child);
        }
      }
    }

    // Soft-delete everything in a single pipeline
    const deletePipeline = redis.pipeline();
    for (const sid of toDelete) {
      deletePipeline.hset(`lc:session:${sid}`, { deleted: "true" });
    }
    await deletePipeline.exec();

    return NextResponse.json({ ok: true, deleted: toDelete.size });
  } catch (err) {
    console.error("[session DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
