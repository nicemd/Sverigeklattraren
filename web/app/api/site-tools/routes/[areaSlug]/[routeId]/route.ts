import { NextRequest, NextResponse } from "next/server";
import { getClimbingRouteDetails } from "@/lib/site-tools";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ areaSlug: string; routeId: string }> }) {
  const { areaSlug, routeId } = await context.params;
  const includeBeta = request.nextUrl.searchParams.get("includeBeta") === "true";
  const route = await getClimbingRouteDetails(areaSlug, routeId, includeBeta);
  return route ? NextResponse.json(route) : NextResponse.json({ error: "Climbing route not found." }, { status: 404 });
}
