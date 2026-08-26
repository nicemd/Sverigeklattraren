import { NextRequest, NextResponse } from "next/server";
import { getClimbingSectorGuide } from "@/lib/site-tools";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ areaSlug: string; sectorId: string }> }) {
  const { areaSlug, sectorId } = await context.params;
  const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Invalid sector page." }, { status: 400 });
  }
  const sector = await getClimbingSectorGuide(areaSlug, sectorId, offset, limit);
  return sector ? NextResponse.json(sector) : NextResponse.json({ error: "Climbing sector not found." }, { status: 404 });
}
