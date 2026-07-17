import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccessSlug, parseAccessHtml } from "../lib/access-core.mjs";

test("normalizes historical access slugs to current URL-safe slugs", () => {
  assert.equal(normalizeAccessSlug("träleberget"), "traleberget");
  assert.equal(normalizeAccessSlug(" Aspen "), "aspen");
  assert.equal(normalizeAccessSlug("../../etc/passwd"), null);
  assert.equal(normalizeAccessSlug(""), null);
  assert.equal(normalizeAccessSlug("x".repeat(121)), null);
});

test("parses authoritative access status, source time and readable copy", () => {
  const html = `<!doctype html><article class="hentry category-kanslig-situation">
    <div class="post-content"><header><h1>Träleberget &amp; Amfiteatern</h1><aside>Kategorimetadata</aside></header>
    <p>Sektorerna är <strong>stängda tillsvidare</strong>.</p><script>inte läsbart</script></div>
    <time class="entry-date updated" datetime="2026-05-18T09:30:00+02:00"></time>
    <meta itemprop="dateModified" content="2026-05-18T10:45:00+02:00">
    <div class="entry-footer">metadata</div></article>`;
  assert.deepEqual(parseAccessHtml(html, "fallback"), {
    title: "Träleberget & Amfiteatern",
    status: "Känslig situation",
    summary: "Sektorerna är stängda tillsvidare.",
    sourceUpdatedAt: "2026-05-18T10:45:00+02:00",
  });
});

test("recognizes full and partial climbing stops", () => {
  assert.equal(parseAccessHtml('<article class="category-totalt-klatterstopp"><h1>A</h1><div class="post-content">Stängt</div></article>', "A").status, "Totalt klätterstopp");
  assert.equal(parseAccessHtml('<article class="category-delvis-klatterstopp"><h1>B</h1><div class="post-content">Delvis</div></article>', "B").status, "Delvis klätterstopp");
});
