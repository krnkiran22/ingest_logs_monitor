import { NextResponse } from "next/server";
import { fetchBackendJson, hasExternalBackend } from "@/lib/backend";
import { getMachineCatalog } from "@/lib/fleet";

export const runtime = "nodejs";

export async function GET() {
  if (hasExternalBackend()) {
    return NextResponse.json(
      await fetchBackendJson<{ machines: Awaited<ReturnType<typeof getMachineCatalog>> }>(
        "/api/machines",
      ),
    );
  }

  return NextResponse.json({ machines: await getMachineCatalog() });
}
