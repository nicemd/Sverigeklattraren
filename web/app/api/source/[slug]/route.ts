import { readFile } from "node:fs/promises";
import path from "node:path";
import { getArea, repositoryRoot } from "@/lib/content";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const area = await getArea(slug);
  const sourcePath = area?.provenance.sources[0]?.path;
  if (!area || !sourcePath) return new Response("Källan hittades inte.", { status: 404 });
  const absolute = path.resolve(repositoryRoot, sourcePath);
  if (!absolute.startsWith(path.resolve(repositoryRoot, "mediawiki") + path.sep)) return new Response("Ogiltig källsökväg.", { status: 400 });
  return new Response(await readFile(absolute, "utf8"), {
    headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `inline; filename="${area.slug}.txt"` },
  });
}
