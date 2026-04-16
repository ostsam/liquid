import { NextRequest, NextResponse } from "next/server";

import type { PersistedSessionPayload } from "@/lib/liquid/types";
import {
  getSession,
  patchSession,
  softDeleteSessionTree,
  upsertSession,
} from "@/server/liquid/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
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
    const body = (await req.json()) as PersistedSessionPayload;

    await upsertSession(id, {
      inputText: body.inputText ?? "",
      controls: body.controls ?? null,
      activeValues: body.activeValues ?? {},
      outputText: body.outputText ?? "",
      rootSessionId: body.rootSessionId ?? id,
      parentSessionId: body.parentSessionId ?? null,
      createdAt: body.createdAt ?? Date.now().toString(),
    });

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
    const { outputText, controls, activeValues } = await req.json();

    await patchSession(id, {
      outputText,
      controls,
      activeValues,
    });

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
    const deleted = await softDeleteSessionTree(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error("[session DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
