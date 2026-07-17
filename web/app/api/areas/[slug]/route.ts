import { NextResponse } from "next/server";
import { getArea } from "@/lib/content";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const area = await getArea(slug);
  return area ? NextResponse.json(area) : NextResponse.json({ error: "Området hittades inte." }, { status: 404 });
}
