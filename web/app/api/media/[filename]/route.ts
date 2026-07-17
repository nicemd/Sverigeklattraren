import { readFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/lib/content";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  if (filename !== path.basename(filename)) return new Response("Ogiltigt filnamn.", { status: 400 });
  const absolute = path.join(repositoryRoot, "images", filename);
  try {
    const data = await readFile(absolute);
    return new Response(data, { headers: { "content-type": contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream", "cache-control": "public, max-age=86400" } });
  } catch { return new Response("Bilden hittades inte.", { status: 404 }); }
}
