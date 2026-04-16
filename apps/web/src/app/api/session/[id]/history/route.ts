import { NextRequest, NextResponse } from "next/server";

import type { SessionHistoryEntry } from "@/lib/liquid/types";
import { appendHistory, getHistory } from "@/server/liquid/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(await getHistory(id));
  } catch (err) {
    console.error("[history GET]", err);
    return NextResponse.json([], { status: 200 }); // Graceful degradation
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as SessionHistoryEntry;

    await appendHistory(id, {
      controlId: body.controlId,
      value: body.value,
      outputSnapshot: body.outputSnapshot,
      timestamp: body.timestamp ?? Date.now().toString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[history POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
