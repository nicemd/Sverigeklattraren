import { NextResponse } from "next/server";
import { getAreaSummaries } from "@/lib/content";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAreaSummaries());
}
