import "server-only";
import { unstable_cache } from "next/cache";
import { normalizeAccessSlug, parseAccessHtml } from "./access-core.mjs";

const fetchCachedAccessInfo = unstable_cache(async (slug: string) => {
  const url = `https://access.klatterforbundet.se/${encodeURIComponent(slug)}/`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Sverigeklattraren/2026 (+https://github.com/nicemd/Sverigeklattraren)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const parsed = parseAccessHtml(await response.text(), slug);
  return { ...parsed, url, fetchedAt: new Date().toISOString() };
}, ["access-info-v2"], { revalidate: 21_600 });

export async function getAccessInfo(rawSlug: string) {
  const slug = normalizeAccessSlug(rawSlug);
  return slug ? fetchCachedAccessInfo(slug) : null;
}
