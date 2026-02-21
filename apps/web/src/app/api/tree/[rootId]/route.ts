/**
 * GET /api/tree/[rootId]
 *
 * Returns all sessions in a version tree, including their metadata and
 * output previews. Powers the VersionTree component.
 *
 * Uses the lc:tree:{rootId}:sessions set to enumerate all session IDs
 * that belong to the tree rooted at rootId.
 */

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

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
  { params }: { params: Promise<{ rootId: string }> }
) {
  try {
    const { rootId } = await params;

    // Get all session IDs registered in this tree
    const sessionIds = await redis.smembers<string[]>(
      `lc:tree:${rootId}:sessions`
    );

    if (!sessionIds || sessionIds.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch all sessions in parallel
    const sessions = await Promise.all(
      sessionIds.map(async (sid) => {
        try {
          const raw = await redis.hgetall<Record<string, unknown>>(
            `lc:session:${sid}`
          );
          if (!raw) return null;

          // Parse controls to extract scalar/toggle labels for the preview
          const controls = raw.controlsJson
            ? safeParseJson<{ scalars?: { label: string }[] } | null>(
                raw.controlsJson,
                null
              )
            : null;

          const controlLabels = controls?.scalars
            ? controls.scalars.map((s) => s.label).join(", ")
            : null;

          return {
            sessionId: sid,
            outputText: raw.outputText ?? "",
            inputText: raw.inputText ?? "",
            controlLabels,
            createdAt: raw.createdAt ?? raw.updatedAt ?? "0",
            updatedAt: raw.updatedAt ?? "0",
            parentSessionId:
              raw.parentSessionId && raw.parentSessionId !== ""
                ? raw.parentSessionId
                : null,
            rootSessionId: raw.rootSessionId ?? rootId,
            deleted: raw.deleted === "true",
          };
        } catch {
          return null;
        }
      })
    );

    return NextResponse.json(sessions.filter(Boolean));
  } catch (err) {
    console.error("[tree GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
