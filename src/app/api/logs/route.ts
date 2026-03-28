import { NextRequest, NextResponse } from "next/server";
import type { LogSource } from "@/lib/fleet";
import { readRemoteLog } from "@/lib/remote";

export const runtime = "nodejs";

function parseLines(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 160;
  }
  return Math.max(20, Math.min(400, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  const machine = request.nextUrl.searchParams.get("machine");
  const source = request.nextUrl.searchParams.get("source") as LogSource | null;
  const lines = parseLines(request.nextUrl.searchParams.get("lines"));

  if (!machine || !source) {
    return NextResponse.json(
      { error: "machine and source are required" },
      { status: 400 },
    );
  }

  try {
    const payload = await readRemoteLog(machine, source, lines);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
