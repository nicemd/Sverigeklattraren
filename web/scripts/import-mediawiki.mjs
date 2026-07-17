import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const inputDir = path.join(repoRoot, "mediawiki");
const outputDir = path.join(repoRoot, "content", "areas");
const imageIndex = new Map();

const slugify = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/å/g, "a")
  .replace(/ä/g, "a")
  .replace(/ö/g, "o")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

function extractTemplates(source) {
  const templates = [];
  for (let start = 0; start < source.length - 1; start += 1) {
    if (source[start] !== "{" || source[start + 1] !== "{") continue;
    let depth = 1;
    let cursor = start + 2;
    while (cursor < source.length - 1 && depth > 0) {
      if (source[cursor] === "{" && source[cursor + 1] === "{") {
        depth += 1;
        cursor += 2;
      } else if (source[cursor] === "}" && source[cursor + 1] === "}") {
        depth -= 1;
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    if (depth === 0) {
      templates.push(source.slice(start + 2, cursor - 2));
      start = cursor - 1;
    }
  }
  return templates;
}

function splitTemplate(template) {
  const parts = [];
  let current = "";
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < template.length; index += 1) {
    const pair = template.slice(index, index + 2);
    if (pair === "{{") braces += 1;
    if (pair === "}}") braces = Math.max(0, braces - 1);
    if (pair === "[[") brackets += 1;
    if (pair === "]]" ) brackets = Math.max(0, brackets - 1);
    if (template[index] === "|" && braces === 0 && brackets === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += template[index];
    }
  }
  parts.push(current.trim());
  const [name = "", ...rawArgs] = parts;
  const args = {};
  rawArgs.forEach((part, index) => {
    const equals = part.indexOf("=");
    if (equals === -1) args[String(index + 1)] = part.trim();
    else args[part.slice(0, equals).trim().toLowerCase()] = part.slice(equals + 1).trim();
  });
  return { name: name.trim().toLowerCase(), args };
}

function plainText(source) {
  return source
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<googlemap[^]*?<\/googlemap>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[(?:bild|image):[^\]]+\]\]/gi, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, "$2")
    .replace(/\[(https?:\/\/[^\]]+)\]/g, "$1")
    .replace(/\{\{[^]*?\}\}/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/^\s*[|{}!].*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSections(source) {
  const matches = [...source.matchAll(/^={2,4}\s*(.*?)\s*={2,4}\s*$/gm)];
  return matches.map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? source.length;
    return {
      id: slugify(plainText(match[1])),
      title: plainText(match[1]).replace(/\s+/g, " "),
      body: plainText(source.slice(bodyStart, bodyEnd)),
    };
  }).filter((section) => section.title && section.body);
}

function numeric(value) {
  if (!value) return null;
  const result = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

function parseArea(filename, source, uniqueSlug) {
  const name = path.basename(filename, ".txt");
  const templates = extractTemplates(source).map(splitTemplate);
  const info = templates.find((template) => ["info klippa", "info boulderområde"].includes(template.name));
  const routes = templates
    .filter((template) => template.name === "led" || template.name === "problem")
    .map((template, index) => ({
      id: `${uniqueSlug}-${template.name}-${index + 1}`,
      kind: template.name === "led" ? "route" : "problem",
      number: template.args.nr || null,
      name: plainText(template.args.namn || `Namnlös ${template.name}`),
      grade: plainText(template.args.grad || ""),
      length: plainText(template.args.längd || template.args.läng || ""),
      type: plainText(template.args.typ || ""),
      firstAscent: plainText(template.args.fa || ""),
      description: plainText(template.args.text || ""),
      source: { id: `legacy:${uniqueSlug}`, path: `mediawiki/${filename}` },
    }));
  const categories = [...source.matchAll(/\[\[kategori:([^\]]+)\]\]/gi)]
    .map((match) => plainText(match[1]))
    .filter(Boolean);
  const images = [...source.matchAll(/\[\[(?:bild|image):([^|\]]+)(?:\|([^\]]*))?\]\]/gi)]
    .map((match) => {
      const options = (match[2] || "").split("|").map((part) => part.trim());
      const requested = match[1].trim();
      const filename = imageIndex.get(requested.toLowerCase()) || imageIndex.get(requested.toLowerCase().replaceAll(" ", "_")) || requested;
      return { filename, caption: plainText(options.at(-1) || ""), missing: !imageIndex.has(filename.toLowerCase()) };
    });
  const accessTemplate = templates.find((template) => template.name === "accessdb");
  const sections = parseSections(source);
  const latitude = numeric(info?.args.lat);
  const longitude = numeric(info?.args.long);
  const coordinatesValid = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const description = sections.find((section) => /allmänt|beskrivning|om området/i.test(section.title))?.body
    || plainText(source.slice(0, source.search(/^==/m) === -1 ? source.length : source.search(/^==/m)))
    || `${routes.length} dokumenterade leder och problem.`;

  return {
    schemaVersion: 1,
    id: uniqueSlug,
    slug: uniqueSlug,
    name,
    description,
    coordinates: coordinatesValid ? { latitude, longitude } : null,
    categories: [...new Set(categories)].sort((a, b) => a.localeCompare(b, "sv")),
    sections,
    routes,
    images,
    access: {
      legacyText: sections.find((section) => /access/i.test(section.title))?.body || null,
      federationSlug: accessTemplate?.args.klippa || null,
    },
    qualityIssues: info && !coordinatesValid ? [{ code: "invalid_coordinates", message: `Originalet innehåller ogiltiga koordinater: ${info.args.lat || "–"}, ${info.args.long || "–"}.` }] : [],
    provenance: {
      primarySourceId: `legacy:${uniqueSlug}`,
      sources: [{
        id: `legacy:${uniqueSlug}`,
        title: `Sverigeföraren 2014: ${name}`,
        path: `mediawiki/${filename}`,
        license: "GNU Free Documentation License",
        snapshotDate: "2014-01-01",
      }],
    },
  };
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const files = (await readdir(inputDir)).filter((filename) => filename.toLowerCase().endsWith(".txt"));
for (const filename of await readdir(path.join(repoRoot, "images"))) {
  imageIndex.set(filename.toLowerCase(), filename);
  imageIndex.set(filename.toLowerCase().replaceAll("_", " "), filename);
}
const slugOccurrences = new Map();
const manifest = [];
for (const filename of files) {
  const fullPath = path.join(inputDir, filename);
  const source = await readFile(fullPath, "utf8");
  const baseSlug = slugify(path.basename(filename, ".txt"));
  const occurrence = (slugOccurrences.get(baseSlug) || 0) + 1;
  slugOccurrences.set(baseSlug, occurrence);
  const uniqueSlug = occurrence === 1 ? baseSlug : `${baseSlug}-${occurrence}`;
  const area = parseArea(filename, source, uniqueSlug);
  await writeFile(path.join(outputDir, `${area.slug}.json`), `${JSON.stringify(area, null, 2)}\n`);
  manifest.push({
    id: area.id,
    slug: area.slug,
    name: area.name,
    description: area.description,
    coordinates: area.coordinates,
    categories: area.categories,
    routeCount: area.routes.length,
    imageCount: area.images.length,
    accessSlug: area.access.federationSlug,
    searchText: area.routes.map((route) => `${route.name} ${route.grade}`).join(" "),
  });
}
manifest.sort((a, b) => a.name.localeCompare(b.name, "sv"));
await writeFile(path.join(repoRoot, "content", "areas.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Imported ${manifest.length} areas with ${manifest.reduce((sum, area) => sum + area.routeCount, 0)} routes/problems.`);
