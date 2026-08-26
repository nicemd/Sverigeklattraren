import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchClimbingAreas } from "@/lib/site-tools";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().trim().max(160).optional(),
  location: z.string().trim().max(120).optional(),
  discipline: z.string().trim().max(80).optional(),
  minRoutes: z.coerce.number().int().min(0).max(10_000).optional(),
  hasCoordinates: z.boolean().optional(),
  hasAccess: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid area query.", details: parsed.error.issues }, { status: 400 });
  return NextResponse.json(await searchClimbingAreas(parsed.data));
}
