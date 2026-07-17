const entities = { amp: "&", quot: "\"", apos: "'", nbsp: " ", lt: "<", gt: ">", ndash: "–", mdash: "—" };

const decode = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
  .replace(/&([a-z]+);/gi, (_, name) => entities[name.toLowerCase()] || `&${name};`);

const plainText = (value) => decode(value
  .replace(/<script[^]*?<\/script>/gi, " ")
  .replace(/<style[^]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .replace(/\s+([.,;:!?])/g, "$1")
  .trim());

export function normalizeAccessSlug(value) {
  if (/[/\\?#]/.test(value)) return null;
  const normalized = value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized && normalized.length <= 120 ? normalized : null;
}

export function parseAccessHtml(html, fallbackTitle) {
  const title = plainText(html.match(/<h1[^>]*>([^]*?)<\/h1>/i)?.[1] || fallbackTitle);
  const content = (html.match(/class=["'][^"']*(?:post-content|entry-content)[^"']*["'][^>]*>([^]*?)(?:<div[^>]+class=["'][^"']*(?:post-bottom-meta|post-meta|entry-footer)|<footer|<\/article>)/i)?.[1] || "")
    .replace(/<header\b[^]*?<\/header>/gi, " ");
  const modifiedTag = html.match(/<meta\b[^>]*itemprop=["']dateModified["'][^>]*>/i)?.[0];
  const sourceUpdatedAt = modifiedTag?.match(/content=["']([^"']+)["']/i)?.[1]
    || html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]
    || null;
  const status = /category-totalt-klatterstopp/i.test(html) ? "Totalt klätterstopp"
    : /category-delvis-klatterstopp/i.test(html) ? "Delvis klätterstopp"
    : /category-kanslig-situation/i.test(html) ? "Känslig situation"
    : "Aktuell information";
  const fullSummary = plainText(content);
  const summary = fullSummary.length > 900
    ? `${fullSummary.slice(0, 899).replace(/\s+\S*$/, "")}…`
    : fullSummary;
  return { title, status, summary, sourceUpdatedAt };
}
