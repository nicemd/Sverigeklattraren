import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findNearbyClimbingAreas } from "@/lib/site-tools";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(500).optional(),
  discipline: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid nearby-area query.", details: parsed.error.issues }, { status: 400 });
  const query = parsed.data;
  return NextResponse.json(await findNearbyClimbingAreas(
    query.latitude,
    query.longitude,
    query.radiusKm,
    query.discipline,
    query.limit,
  ));
}
