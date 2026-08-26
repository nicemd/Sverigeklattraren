import { NextResponse } from "next/server";
import { getAccessInfo } from "@/lib/access";
import { getArea } from "@/lib/content";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ areaSlug: string }> }) {
  const { areaSlug } = await context.params;
  const area = await getArea(areaSlug);
  if (!area) return NextResponse.json({ error: "Climbing area not found." }, { status: 404 });

  const federationSlug = area.access.federationSlug;
  const current = federationSlug ? await getAccessInfo(federationSlug).catch(() => null) : null;
  return NextResponse.json({
    area: { slug: area.slug, name: area.name },
    current,
    legacy: area.access.legacyText ? {
      summary: area.access.legacyText,
      source: "Sverigeföraren 2014",
      warning: "Historical information; verify current access before departure.",
    } : null,
    currentSourceConnected: Boolean(federationSlug),
    warning: current ? null : federationSlug
      ? "The Swedish Climbing Federation access source could not be reached. Do not treat historical access information as current."
      : "No direct Swedish Climbing Federation access source is connected for this area.",
  });
}
