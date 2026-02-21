/**
 * GET /api/session/[id]/history
 *
 * Returns the full sculpting history stream for a session.
 * Powers the ReplayBar — pure Redis reads, no LLM calls.
 */

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = await redis.xrange(`lc:session:${id}:history`, "-", "+");

    if (!raw) {
      return NextResponse.json([]);
    }

    const entries = Object.entries(
      raw as Record<string, Record<string, unknown>>
    ).map(([streamId, message]) => ({
      id: streamId,
      controlId: String(message["controlId"] ?? ""),
      value: String(message["value"] ?? ""),
      outputSnapshot: String(message["outputSnapshot"] ?? ""),
      timestamp: String(message["timestamp"] ?? ""),
    }));

    return NextResponse.json(entries);
  } catch (err) {
    console.error("[history GET]", err);
    return NextResponse.json([], { status: 200 }); // Graceful degradation
  }
}
