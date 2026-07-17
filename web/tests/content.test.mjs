import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(process.cwd(), "..");
const contentRoot = path.join(repoRoot, "content");

test("imports every legacy MediaWiki area", async () => {
  const [legacy, generated, manifest] = await Promise.all([
    readdir(path.join(repoRoot, "mediawiki")),
    readdir(path.join(contentRoot, "areas")),
    readFile(path.join(contentRoot, "areas.json"), "utf8").then(JSON.parse),
  ]);
  const legacyCount = legacy.filter((name) => name.endsWith(".txt")).length;
  assert.equal(generated.length, legacyCount);
  assert.equal(manifest.length, legacyCount);
  assert.ok(manifest.reduce((sum, area) => sum + area.routeCount, 0) > 14_000);
});

test("preserves source and route provenance", async () => {
  const files = await readdir(path.join(contentRoot, "areas"));
  const areas = await Promise.all(files.slice(0, 40).map((name) => readFile(path.join(contentRoot, "areas", name), "utf8").then(JSON.parse)));
  for (const area of areas) {
    assert.equal(area.schemaVersion, 1);
    assert.match(area.provenance.primarySourceId, /^legacy:/);
    assert.match(area.provenance.sources[0].path, /^mediawiki\/.+\.txt$/);
    for (const route of area.routes) assert.equal(route.source.id, area.provenance.primarySourceId);
  }
});

test("coordinates stay inside valid WGS84 bounds", async () => {
  const manifest = JSON.parse(await readFile(path.join(contentRoot, "areas.json"), "utf8"));
  for (const area of manifest.filter((item) => item.coordinates?.latitude && item.coordinates?.longitude)) {
    assert.ok(area.coordinates.latitude >= -90 && area.coordinates.latitude <= 90, `${area.name}: latitude`);
    assert.ok(area.coordinates.longitude >= -180 && area.coordinates.longitude <= 180, `${area.name}: longitude`);
  }
});

test("keeps route order and sector context needed to find a route at the crag", async () => {
  const utby = JSON.parse(await readFile(path.join(contentRoot, "areas", "utby.json"), "utf8"));
  const carlsberg = utby.routes.find((route) => route.name === "Carlsberg Export");
  assert.ok(carlsberg, "Carlsberg Export should be searchable");
  assert.equal(utby.sections.find((section) => section.id === carlsberg.sectorId)?.title, "Stora väggen");
  const sectorRoutes = utby.routes.filter((route) => route.sectorId === carlsberg.sectorId);
  const index = sectorRoutes.findIndex((route) => route.id === carlsberg.id);
  assert.equal(sectorRoutes[index - 1]?.name, "Carlsberg direkt");
  assert.equal(sectorRoutes[index + 1]?.name, "Urquell");
  assert.match(utby.sections.find((section) => section.id === carlsberg.sectorId)?.body || "", /Hitta hit:/i);
});

test("keeps Nacka Kvarn sport, boulder, sketches and source numbers aligned", async () => {
  const area = JSON.parse(await readFile(path.join(contentRoot, "areas", "nacka-kvarn.json"), "utf8"));
  const blind = area.routes.find((route) => route.name === "Blind");
  const flinka = area.routes.find((route) => route.name === "Flinka Fingrar");
  const getItShorty = area.routes.find((route) => route.name === "Get It Shorty");
  assert.deepEqual({ kind: blind.kind, sector: blind.sectorId, number: blind.number }, { kind: "route", sector: "huvudvaggen", number: "1" });
  assert.deepEqual({ kind: flinka.kind, sector: flinka.sectorId, number: flinka.number }, { kind: "problem", sector: "grottan", number: "1" });
  assert.deepEqual({ kind: getItShorty.kind, sector: getItShorty.sectorId, number: getItShorty.number, grade: getItShorty.grade }, { kind: "problem", sector: "vaggen", number: "10a", grade: "7B" });
  assert.ok(area.images.some((image) => image.filename === "Nackakvarn1.gif" && image.sectorId === "huvudvaggen"));
  assert.ok(area.images.some((image) => image.filename === "NKGrottan.jpg" && image.sectorId === "grottan"));
  assert.ok(area.images.some((image) => image.filename === "NK_Mossebacke2.jpg" && image.routeIds.includes(getItShorty.id)));
  assert.ok(area.images.find((image) => image.filename === "NK_Mossebacke2.jpg")?.routeRelations.some((relation) => relation.routeId === getItShorty.id));
  assert.match(area.sections.find((section) => section.id === "vagbeskrivning")?.body || "", /gångbro över ån/i);
});

test("turns legacy boulder templates, loose notes and external links into usable content", async () => {
  const [orminge, askimsbadet, almenas] = await Promise.all([
    readFile(path.join(contentRoot, "areas", "orminge.json"), "utf8").then(JSON.parse),
    readFile(path.join(contentRoot, "areas", "askimsbadet.json"), "utf8").then(JSON.parse),
    readFile(path.join(contentRoot, "areas", "almenas.json"), "utf8").then(JSON.parse),
  ]);
  const wongSai = orminge.routes.find((route) => route.name === "Wong-Sai");
  assert.ok(orminge.routes.every((route) => route.kind === "problem"));
  assert.deepEqual({ sector: wongSai.sectorId, number: wongSai.number, grade: wongSai.grade }, { sector: "hogra-delen", number: "4, gul", grade: "7b+ sd" });
  assert.ok(orminge.images.some((image) => image.filename === "Orminge_wongsai.jpg" && image.caption === "Wong-Sai" && image.sectorId === "hogra-delen"));
  assert.notEqual(orminge.images.find((image) => image.filename === "Orminge_spineless.jpg")?.sectorId, wongSai.sectorId);
  assert.ok(orminge.sections.every((section) => !/\[\[|\]\]|\{\{|\}\}/.test(section.body)), "publicerad copy ska inte innehålla wikiartefakter");
  assert.match(orminge.sections.find((section) => section.id === "vagbeskrivning")?.body || "", /• Överhängande Väggen/);
  assert.equal(askimsbadet.routes.length, 0);
  assert.match(askimsbadet.sections.find((section) => section.id === "historia")?.body || "", /Patrik Alseby/);
  assert.ok(askimsbadet.images.some((image) => image.caption));
  assert.ok(almenas.externalLinks.some((link) => link.url.endsWith("ALMENAS_BoulderGuide.pdf")));
  assert.doesNotMatch(almenas.description, /Kategori:/i);
});

test("does not leak common MediaWiki artifacts into reader-facing copy", async () => {
  const files = await readdir(path.join(contentRoot, "areas"));
  for (const filename of files) {
    const area = JSON.parse(await readFile(path.join(contentRoot, "areas", filename), "utf8"));
    const copy = [area.description, ...area.sections.map((section) => section.body), ...area.routes.map((route) => route.description)].join("\n");
    const readerFacingCopy = copy.replace(/https?:\/\/\S+/g, "");
    assert.doesNotMatch(readerFacingCopy, /\[\[|\{\{|\b(?:Kategori|Category):|\b(?:Fil|File):[^\s]+\.(?:jpe?g|png|gif)/i, filename);
  }
});

test("links Häggsta route numbers to original sketches with reviewable vision evidence", async () => {
  const haggsta = JSON.parse(await readFile(path.join(contentRoot, "areas", "haggsta.json"), "utf8"));
  const sjotraversen = haggsta.routes.find((route) => route.name === "Sjötraversen");
  const sketch = haggsta.images.find((image) => image.filename === "Haggsta_sjosidan_v.png");
  const relation = sketch?.routeRelations.find((item) => item.routeId === sjotraversen?.id);
  assert.deepEqual({ kind: sketch?.imageKind, method: relation?.method, confidence: relation?.confidence }, { kind: "topo", method: "vision", confidence: 0.97 });
  assert.ok(relation?.evidence);
});

test("promotes numbered loose route lists into sourced structured routes", async () => {
  const haggsta = JSON.parse(await readFile(path.join(contentRoot, "areas", "haggsta.json"), "utf8"));
  const spiderPig = haggsta.routes.find((route) => route.name === "Spider-pig");
  assert.deepEqual({ sector: spiderPig?.sectorId, number: spiderPig?.number, grade: spiderPig?.grade, length: spiderPig?.length, method: spiderPig?.extraction?.method }, { sector: "nya-vaggen", number: "1", grade: "V-", length: "13", method: "llm" });
  assert.ok(spiderPig?.extraction?.confidence >= 0.9);
  assert.doesNotMatch(haggsta.sections.find((section) => section.id === "nya-vaggen")?.body || "", /Spider-pig/);
});

test("keeps directions as semantic headings, paragraphs and lists", async () => {
  const orminge = JSON.parse(await readFile(path.join(contentRoot, "areas", "orminge.json"), "utf8"));
  const directions = orminge.sections.find((section) => /vägbeskrivning/i.test(section.title));
  assert.equal(directions?.blocks?.[0]?.kind, "heading");
  assert.equal(directions?.blocks?.[0]?.text, "Överhängande Väggen med bil");
  assert.ok(directions?.blocks?.some((block) => block.kind === "list" && block.items.length === 4));
});

test("replays committed auto-published proposals during a fresh import", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "sverigeforaren-import-"));
  const proposalDir = path.join(process.cwd(), "tests", "fixtures", "proposals");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/import-mediawiki.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, CONTENT_OUTPUT_ROOT: output, PROPOSAL_DIR: proposalDir },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Importer exited ${code}`)));
    });
    const utby = JSON.parse(await readFile(path.join(output, "areas", "utby.json"), "utf8"));
    assert.equal(utby.description, "Verifierad testbeskrivning som ska överleva en fullständig nyimport.");
    assert.ok(utby.provenance.sources.some((source) => source.url === "https://example.test/source"));
    const carlsberg = utby.routes.find((route) => route.id === "utby-led-74");
    const externalSource = utby.provenance.sources.find((source) => source.url === "https://example.test/source");
    assert.ok(carlsberg.fieldSources.grade.includes(externalSource.id));
    assert.equal(externalSource.usage, "fact-reference");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
