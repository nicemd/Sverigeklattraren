import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
