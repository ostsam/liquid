import { NextRequest, NextResponse } from "next/server";

import { analyzeInput } from "@/server/liquid/analyst";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await analyzeInput(body.inputText);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[analyze POST]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Analyze failed",
      },
      { status: 500 },
    );
  }
}
