import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { translationContextHash, translationPunctuationHash } from "../scripts/translation-context.mjs";

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

test("links Dödskalleberget sectors to the full-size topo that precedes their route block", async () => {
  const area = JSON.parse(await readFile(path.join(contentRoot, "areas", "dodskalleberget.json"), "utf8"));
  const fullTopo = area.images.find((image) => image.filename === "Dodskalleberget_v.png");
  const mainWallRouteIds = area.routes.filter((route) => route.sectorId === "stora-vaggen").map((route) => route.id);
  assert.ok(fullTopo, "the original full-size vertical topo should be published");
  assert.ok(mainWallRouteIds.every((routeId) => fullTopo.routeIds.includes(routeId)), "the topo should remain linked across nested sector headings");
  assert.ok(!area.images.some((image) => image.filename === "Dodskalleberget_liten_h.png"), "a legacy thumbnail should not be published beside its full-size equivalent");
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

test("replays auto-published and human-merged proposals during a fresh import", async () => {
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
    const fingersprickan = utby.routes.find((route) => route.id === "utby-led-2");
    const externalSource = utby.provenance.sources.find((source) => source.url === "https://example.test/source");
    assert.ok(carlsberg.fieldSources.grade.includes(externalSource.id));
    assert.equal(fingersprickan.description, "En kort led med annorlunda grepp.");
    assert.deepEqual(fingersprickan.fieldSources.description, ["legacy:utby"]);
    assert.equal(externalSource.usage, "fact-reference");
    assert.ok(utby.sections.some((section) => section.title === "PR-granskad historik"));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("keeps route descriptions visible and beta in a separate spoiler field", async () => {
  const haggsta = JSON.parse(await readFile(path.join(contentRoot, "areas", "haggsta.json"), "utf8"));
  const spiderPig = haggsta.routes.find((route) => route.name === "Spider-pig");
  assert.match(spiderPig.description, /småstegsklättring/i);
  assert.equal(spiderPig.beta, undefined);

  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  assert.match(component, /className="route-description"[\s\S]*routeDescription\(selectedRoute\)/);
  assert.match(component, /routeBeta\(selectedRoute\)[\s\S]*className="beta-panel"/);
});

test("invalidates cached translations when source context changes, but not when translations are attached", () => {
  const area = {
    name: "Testklippan", description: "En sva leder åt vänster.", categories: ["Sport"],
    sections: [{ id: "sva", title: "Sva-väggen", body: "Väggen vetter mot söder." }],
    routes: [{ id: "led-1", kind: "route", number: "1", name: "Namnet", grade: "6a", type: "sport", sectorId: "sva", description: "Följ sprickan.", beta: "Höger hand på listen." }],
  };
  const originalHash = translationContextHash(area);
  assert.equal(translationContextHash({ ...area, translations: { en: { description: { text: "A slab.", method: "llm", sourceIds: ["legacy:test"] } } } }), originalHash);
  assert.notEqual(translationContextHash({ ...area, routes: [{ ...area.routes[0], description: "Följ diedret." }] }), originalHash);
  assert.equal(translationPunctuationHash(area), translationPunctuationHash({ ...area, routes: [{ ...area.routes[0], description: "Följ sprickan" }] }));
  assert.notEqual(translationPunctuationHash(area), translationPunctuationHash({ ...area, routes: [{ ...area.routes[0], description: "Följ diedret." }] }));
});

test("marks machine translations and keeps the Swedish original available", async () => {
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  assert.match(component, /Machine translated from Swedish/);
  assert.match(component, /<p lang="sv"><RichText text=\{original\}/);
  assert.match(component, /areaTranslation\?\.routes\?\.\[selectedRoute\.id\]\?\.description/);
});

test("separates free guide content from proprietary website software", async () => {
  const root = path.resolve(process.cwd(), "..");
  const softwareNotice = await readFile(path.join(root, "LICENSE"), "utf8");
  const contentNotice = await readFile(path.join(root, "CONTENT_LICENSE.md"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  assert.match(softwareNotice, /All rights reserved/);
  assert.match(softwareNotice, /does not apply to the guide content/i);
  assert.match(contentNotice, /mediawiki\//);
  assert.match(contentNotice, /Translations and editorial rewrites/i);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.match(component, /The website software, design and agent tooling are proprietary/);
  assert.match(component, /accepted guide content is published under GFDL 1\.3/);
});
test("labels a sourced route number explicitly in the field card and linked topo", async () => {
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  assert.match(component, /className="route-title-number"/);
  assert.match(component, /selectedRoute\.number.*routeName\(selectedRoute\)/);
  assert.match(component, /className="route-topo-number"/);
  assert.match(component, /"i skissen", "in topo"/);
});

test("orders field information for arrival, orientation and route finding", async () => {
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  const arrival = component.indexOf('className="arrival-access-grid"');
  const notes = component.indexOf('className={`legacy-notes area-notes');
  const overview = component.indexOf('className="area-overview"');
  const routes = component.indexOf('className="content-grid"');
  assert.ok(arrival >= 0 && arrival < notes && notes < overview && overview < routes);
  assert.match(component, /className="route-detail-navigation"/);
  assert.match(component, /openRouteCard\(previousRoute\.id, true\)/);
  assert.match(component, /openRouteCard\(nextRoute\.id, true\)/);
  assert.match(component, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(component, /window\.addEventListener\("popstate"/);
  assert.match(component, /closeRouteCard/);
  assert.match(component, /className="route-detail-context"/);
});

test("prefers source-linked sector topos over unlinked historical images", async () => {
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  assert.match(component, /const related = candidates\.filter/);
  assert.match(component, /if \(related\.length\) return rank\(related\)/);
  assert.match(component, /const groupImages = allGroupImages\.slice\(0, 1\)/);
});

test("requests missing English area and route descriptions through the context-aware runtime translator", async () => {
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  const runtime = await readFile(path.join(process.cwd(), "lib", "translation-runtime.ts"), "utf8");
  assert.match(component, /fetch\(`\/api\/translations\/\$\{encodeURIComponent\(area\.slug\)\}`/);
  assert.match(component, /body: JSON\.stringify\(\{ routeId: selectedRoute\.id \}\)/);
  assert.match(component, /Translating route description with sector context/);
  assert.match(component, /selectedRouteTranslationComplete/);
  assert.match(runtime, /neighbouring-routes/);
  assert.match(runtime, /Preserve route and place names, grades, route numbers/);
});

test("uses Sverigeklättraren as the product while preserving Sverigeföraren as its source", async () => {
  const root = path.resolve(process.cwd(), "..");
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const layout = await readFile(path.join(process.cwd(), "app", "layout.tsx"), "utf8");
  const component = await readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.match(readme, /^# Sverigeklättraren/m);
  assert.match(readme, /fork of Sverigeföraren/);
  assert.match(layout, /default: "Sverigeklättraren"/);
  assert.match(component, /<strong>Sverigeklättraren<\/strong>/);
  assert.match(component, /brand-mark">SK/);
  assert.doesNotMatch(component, /<strong>Sverigeföraren<\/strong>/);
  assert.equal(packageJson.name, "sverigeklattraren-web");

  assert.match(readme, /Sverigeföraren\.se was founded in 2006/);
  assert.match(component, /Sverigeföraren\.se grundades 2006/);
  assert.match(component, /Från Sverigeföraren 2014/);
});

test("does not present an area overview as a route topo at Ringkallen", async () => {
  const area = JSON.parse(await readFile(path.join(contentRoot, "areas", "ringkallen.json"), "utf8"));
  const route = area.routes.find((item) => item.name === "Sträckbänken");
  const overview = area.images.find((image) => image.filename === "Ringkallen_oversikt_split.jpg");
  const middleTopo = area.images.find((image) => image.filename === "Fikaväggen_mitt_topo.jpg");
  const petTopo = area.images.find((image) => image.filename === "Pet-problemväggen.jpg");
  const tango = area.routes.find((item) => item.name === "Tango för två");

  assert.ok(route && overview && middleTopo && tango && petTopo);
  assert.ok(!overview.routeIds.includes(route.id), "an area overview without route lines must not be inherited by the following route list");
  assert.ok(!middleTopo.routeIds.includes(route.id), "the next topo belongs to its following route group, not Sträckbänken");
  assert.ok(middleTopo.routeIds.includes(tango.id));
  assert.ok(!area.images.some((image) => image.routeIds?.includes(route.id)), "Sträckbänken has no safely linked topo in the original guide");
  assert.ok(petTopo.routeIds.length > 0, "the Pet Problem topo should retain its own route block");
  assert.ok(petTopo.routeIds.every((routeId) => area.routes.find((item) => item.id === routeId)?.sectorId === "overhangande-vaggen"), "a sector topo must stop at the next peer sector heading");
});
test("keeps edit proposals grounded, observable and single-shot", async () => {
  const [component, intake, editor, reviewer, publisher, githubPublisher] = await Promise.all([
    readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "agents", "intake.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "agents", "editor.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "agents", "reviewer.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "publish.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "github-publish.ts"), "utf8"),
  ]);
  assert.match(component, /const needsSuggestionArea = showLanding \|\| !selected/);
  assert.match(component, /if \(needsSuggestionArea\) \{ void ensureAreaIndex\(\); setShowLanding\(false\); setSelected\(null\)/);
  assert.match(component, /className="suggestion-progress"[\s\S]*pendingSeconds/);
  assert.match(component, /disabled=\{completed\}/);
  assert.match(intake + editor + publisher, /sourceId/);
  assert.match(reviewer, /canonicalTargets\(area, edit\)/);
  assert.match(githubPublisher, /setTimeout\(\(\) => child\.kill\(\), 90_000\)/);
  assert.match(githubPublisher, /setTimeout\(resolve, 10_000\)/);
});
test("keeps the landing page area-light and offers a clustered Sweden map", async () => {
  const [page, component, css, areaIndexApi] = await Promise.all([
    readFile(path.join(process.cwd(), "app", "page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "components", "GuideApp.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "globals.css"), "utf8"),
    readFile(path.join(process.cwd(), "app", "api", "areas", "route.ts"), "utf8"),
  ]);
  assert.doesNotMatch(page, /getArea\(/);
  assert.match(page, /initialArea=\{null\}/);
  assert.match(page, /searchText:\s*""/);
  assert.match(component, /function LandingMap[\s\S]*cluster:\s*true/);
  assert.match(component, /Hitta klättring nära dig/);
  assert.match(component, /<LandingMap areas=\{areas\}/);
  assert.match(component, /fetch\("\/api\/areas"\)/);
  assert.match(areaIndexApi, /getAreaSummaries/);
  assert.match(css, /\.landing-map-frame[\s\S]*height:\s*clamp/);
});
