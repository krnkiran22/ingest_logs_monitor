import { NextResponse } from "next/server";
import { getMachineCatalog } from "@/lib/fleet";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ machines: await getMachineCatalog() });
}
