import { NextResponse } from "next/server";
import { z } from "zod";
import { getArea } from "@/lib/content";
import { translateAreaCore, translateAreaRoute } from "@/lib/translation-runtime";

export const runtime = "nodejs";
const requestSchema = z.object({ routeId: z.string().min(1).max(160).optional() });
const attempts = new Map<string, number[]>();

function isRateLimited(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const cutoff = Date.now() - 10 * 60 * 1000;
  const recent = (attempts.get(key) || []).filter((timestamp) => timestamp > cutoff);
  recent.push(Date.now());
  attempts.set(key, recent);
  return recent.length > 12;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI API är inte konfigurerat." }, { status: 503 });
  if (isRateLimited(request)) return NextResponse.json({ error: "För många översättningar. Vänta några minuter." }, { status: 429 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig översättningsbegäran." }, { status: 400 });
  const { slug } = await context.params;
  const area = await getArea(slug);
  if (!area) return NextResponse.json({ error: "Området hittades inte." }, { status: 404 });
  try {
    const translation = parsed.data.routeId ? await translateAreaRoute(area, parsed.data.routeId) : await translateAreaCore(area);
    return NextResponse.json({ translation });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Översättningen misslyckades. Försök igen." }, { status: 502 });
  }
}
