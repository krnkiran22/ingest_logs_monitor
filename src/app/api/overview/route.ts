import { NextResponse } from "next/server";
import { getFleetOverview } from "@/lib/overview";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getFleetOverview());
}
