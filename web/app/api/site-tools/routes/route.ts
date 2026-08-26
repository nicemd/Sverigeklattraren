import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchClimbingRoutes } from "@/lib/site-tools";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  grade: z.string().trim().max(24).optional(),
  location: z.string().trim().max(120).optional(),
  discipline: z.string().trim().max(80).optional(),
  kind: z.enum(["route", "problem"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).refine((query) => Boolean(query.grade || query.location || query.discipline || query.kind), {
  message: "At least one search filter is required.",
});

function invalidQuery(error: z.ZodError) {
  return NextResponse.json({ error: "Invalid route query.", details: error.issues }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return invalidQuery(parsed.error);
  return NextResponse.json(await searchClimbingRoutes(parsed.data));
}

export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidQuery(parsed.error);
  return NextResponse.json(await searchClimbingRoutes(parsed.data));
}
