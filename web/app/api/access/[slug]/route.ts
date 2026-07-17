import { NextResponse } from "next/server";
import { getAccessInfo } from "@/lib/access";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const info = await getAccessInfo(slug);
    return info ? NextResponse.json(info) : NextResponse.json({ error: "Accessinformationen hittades inte." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Accessdatabasen kunde inte nås." }, { status: 502 }); }
}
