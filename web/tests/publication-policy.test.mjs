import assert from "node:assert/strict";
import test from "node:test";
import { patchNeedsHumanReview } from "../lib/publication-policy.mjs";

test("always protects access, directions and coordinates from auto-publication", () => {
  assert.equal(patchNeedsHumanReview({ field: "access", value: "Öppet", rationale: "Officiell källa" }), true);
  assert.equal(patchNeedsHumanReview({ field: "coordinates", value: '{"latitude":59,"longitude":18}', rationale: "GPS" }), true);
  assert.equal(patchNeedsHumanReview({ field: "section", value: '{"title":"Parkering","body":"Ny parkeringsplats"}', rationale: "Uppdatering" }), true);
  assert.equal(patchNeedsHumanReview({ field: "description", value: "Klippan är stängd under häckning.", rationale: "" }), true);
});

test("allows low-risk cited route facts through the deterministic policy", () => {
  assert.equal(patchNeedsHumanReview({ field: "route_fact", value: '{"facts":{"name":"Ny led","grade":"6a"}}', rationale: "Namn och grad" }), false);
});
