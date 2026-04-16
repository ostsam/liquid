import { NextRequest, NextResponse } from "next/server";

import { getTreeSessions } from "@/server/liquid/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ rootId: string }> }
) {
  try {
    const { rootId } = await params;
    return NextResponse.json(await getTreeSessions(rootId));
  } catch (err) {
    console.error("[tree GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
