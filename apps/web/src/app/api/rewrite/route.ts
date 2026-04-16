import { NextRequest, NextResponse } from "next/server";

import { streamRewriteInput } from "@/server/liquid/rewriter";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const stream = await streamRewriteInput(body);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[rewrite POST]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Rewrite failed",
      },
      { status: 500 },
    );
  }
}
