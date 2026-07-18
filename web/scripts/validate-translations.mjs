import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { translationContextHash } from "./translation-context.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.resolve(webRoot, "..", "content");
const manifest = JSON.parse(await readFile(path.join(contentRoot, "areas.json"), "utf8"));
const cache = JSON.parse(await readFile(path.join(contentRoot, "enrichment", "translations-en.json"), "utf8"));
const failures = JSON.parse(await readFile(path.join(contentRoot, "enrichment", "translations-en.failures.json"), "utf8"));
const errors = [];
const identical = [];
let translatedSections = 0;
let translatedRoutes = 0;

const sourceNeedsTranslation = (source) => {
  const text = String(source || "").trim();
  return Boolean(text) && !/^=+[^=\r\n]+=+$/.test(text);
};
const requireValue = (value, label, sourceText) => {
  if (!value || typeof value.text !== "string" || (sourceNeedsTranslation(sourceText) && !value.text.trim())) {
    errors.push(`${label}: översättning saknas`);
    return;
  }
  if (value.method !== "llm" || !value.model || !Array.isArray(value.sourceIds) || !value.sourceIds.length) {
    errors.push(`${label}: metadata eller käll-ID saknas`);
  }
  const source = String(sourceText || "").trim();
  if (source.length >= 30 && source === value.text.trim() && /[A-Za-zÅÄÖåäö]/.test(source) && !/^https?:/i.test(source)) {
    identical.push(label);
  }
};

if (manifest.length !== 803) errors.push(`manifestet innehåller ${manifest.length}, förväntat 803 områden`);
if (Object.keys(cache.areas || {}).length !== manifest.length) errors.push(`cachen innehåller ${Object.keys(cache.areas || {}).length}/${manifest.length} områden`);
if (Object.keys(failures.failures || {}).length) errors.push(`fellistan innehåller ${Object.keys(failures.failures).length} områden`);

for (const summary of manifest) {
  const area = JSON.parse(await readFile(path.join(contentRoot, "areas", `${summary.slug}.json`), "utf8"));
  const cached = cache.areas?.[summary.slug];
  const attached = area.translations?.en;
  if (!cached) { errors.push(`${summary.slug}: cachepost saknas`); continue; }
  if (cached.contextHash !== translationContextHash(area)) errors.push(`${summary.slug}: inaktuell kontexthash`);
  if (!attached) { errors.push(`${summary.slug}: engelsk översättning saknas i områdesfilen`); continue; }
  if (JSON.stringify(attached) !== JSON.stringify(cached.translation)) errors.push(`${summary.slug}: områdesfil och cache skiljer sig`);
  if (!summary.translations?.en) errors.push(`${summary.slug}: översättning saknas i manifestet`);
  requireValue(attached.description, `${summary.slug}/description`, area.description);

  for (const section of area.sections || []) {
    const translated = attached.sections?.[section.id];
    if (!translated) { errors.push(`${summary.slug}/section/${section.id}: post saknas`); continue; }
    requireValue(translated.title, `${summary.slug}/section/${section.id}/title`, section.title);
    requireValue(translated.body, `${summary.slug}/section/${section.id}/body`, section.body);
    translatedSections += 1;
  }

  for (const route of area.routes || []) {
    if (!route.description && !route.beta) continue;
    const translated = attached.routes?.[route.id];
    if (!translated) { errors.push(`${summary.slug}/route/${route.id}: post saknas`); continue; }
    if (route.description) requireValue(translated.description, `${summary.slug}/route/${route.id}/description`, route.description);
    if (route.beta) requireValue(translated.beta, `${summary.slug}/route/${route.id}/beta`, route.beta);
    translatedRoutes += 1;
  }
}

if (errors.length) {
  console.error(errors.slice(0, 100).join("\n"));
  if (errors.length > 100) console.error(`…och ${errors.length - 100} ytterligare fel.`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${manifest.length} områden, ${translatedSections} sektioner och ${translatedRoutes} beskrivna leder är komplett kopplade till Git-cachen.`);
  console.log(`Manuell granskningskö för identisk käll-/måltext: ${identical.length}.`);
  if (identical.length) console.log(identical.slice(0, 20).join("\n"));
}
