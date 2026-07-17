import "server-only";

const entities: Record<string, string> = { amp: "&", quot: "\"", apos: "'", nbsp: " ", lt: "<", gt: ">" };
const decode = (value: string) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&([a-z]+);/gi, (_, name) => entities[name.toLowerCase()] || `&${name};`);
const text = (value: string) => decode(value.replace(/<script[^]*?<\/script>/gi, " ").replace(/<style[^]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

export async function getAccessInfo(slug: string) {
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  const url = `https://access.klatterforbundet.se/${slug}/`;
  const response = await fetch(url, { headers: { "user-agent": "Sverigeforaren/2026 (+https://github.com/nicemd/Sverigeforaren)" }, next: { revalidate: 21600 } });
  if (!response.ok) return null;
  const html = await response.text();
  const title = text(html.match(/<h1[^>]*>([^]*?)<\/h1>/i)?.[1] || slug);
  const content = html.match(/class=["'][^"']*post-content[^"']*["'][^>]*>([^]*?)(?:<div[^>]+class=["'][^"']*post-bottom-meta|<footer|<\/article>)/i)?.[1] || "";
  const sourceUpdatedAt = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] || null;
  const postClasses = html.match(/class=["']([^"']*\bhentry\b[^"']*)["']/i)?.[1] || "";
  const status = /category-totalt-klatterstopp/i.test(postClasses) ? "Totalt klätterstopp"
    : /category-delvis-klatterstopp/i.test(postClasses) ? "Delvis klätterstopp"
    : /category-kanslig-situation/i.test(postClasses) ? "Känslig situation"
    : "Aktuell information";
  return { title, status, summary: text(content).slice(0, 900), url, sourceUpdatedAt, fetchedAt: new Date().toISOString() };
}
