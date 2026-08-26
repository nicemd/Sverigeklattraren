import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compareClimbingAreas } from "@/lib/site-tools";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  areaSlugs: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(2).max(6),
});

export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid area comparison.", details: parsed.error.issues }, { status: 400 });
  return NextResponse.json(await compareClimbingAreas(parsed.data.areaSlugs));
}
