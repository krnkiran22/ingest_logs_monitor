import { NextResponse } from "next/server";
import { fetchBackendJson, hasExternalBackend } from "@/lib/backend";
import { getFleetOverview } from "@/lib/overview";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (hasExternalBackend()) {
      return NextResponse.json(await fetchBackendJson("/api/overview"));
    }

    return NextResponse.json(await getFleetOverview());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
