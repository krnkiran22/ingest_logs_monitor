import { NextRequest, NextResponse } from "next/server";
import { fetchBackendJson, hasExternalBackend } from "@/lib/backend";
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
    if (hasExternalBackend()) {
      const params = new URLSearchParams({
        machine,
        source,
        lines: String(lines),
      });
      return NextResponse.json(
        await fetchBackendJson(`/api/logs?${params.toString()}`),
      );
    }

    const payload = await readRemoteLog(machine, source, lines);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
