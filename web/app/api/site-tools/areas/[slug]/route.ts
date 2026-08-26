import { NextResponse } from "next/server";
import { getClimbingAreaDetails } from "@/lib/site-tools";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const area = await getClimbingAreaDetails(slug);
  return area ? NextResponse.json(area) : NextResponse.json({ error: "Climbing area not found." }, { status: 404 });
}
