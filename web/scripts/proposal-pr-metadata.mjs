import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { patchNeedsHumanReview } from "../lib/publication-policy.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const diff = spawnSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" });
if (diff.status !== 0) fail(diff.stderr || "Kunde inte läsa PR-diffen.");
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
const proposalFiles = changed.filter((file) => /^proposals\/[^/]+\.json$/.test(file));
if (proposalFiles.length !== 1) fail(`En proposal-PR måste innehålla exakt en proposal-fil, hittade ${proposalFiles.length}.`);

const proposal = JSON.parse(readFileSync(proposalFiles[0], "utf8"));
if (proposal.schemaVersion !== 2 || proposal.workflow?.kind !== "github_pull_request") fail("Proposal-filen saknar giltig GitHub-workflowmetadata.");
if (!["auto_published", "approved_on_merge", "needs_review"].includes(proposal.decision)) fail(`Otillåtet proposal-beslut: ${proposal.decision}`);
if (typeof proposal.area !== "string" || !/^[a-z0-9-]+$/.test(proposal.area)) fail("Proposal-filen har ogiltigt område.");

const allowed = new Set([
  proposalFiles[0],
  "content/areas.json",
  `content/areas/${proposal.area}.json`,
]);
const unexpected = changed.filter((file) => !allowed.has(file));
if (unexpected.length) fail(`Proposal-branchen ändrar otillåtna filer: ${unexpected.join(", ")}`);
const areaContentPath = `content/areas/${proposal.area}.json`;
if (proposal.decision === "needs_review" && changed.some((file) => file.startsWith("content/"))) fail("Ett underkänt förslag får inte innehålla en publicerbar innehållsdiff.");
if (proposal.decision !== "needs_review" && !changed.includes(areaContentPath)) fail("Ett merge-färdigt förslag måste innehålla områdets faktiska innehållsdiff.");

const patches = Array.isArray(proposal.edit?.patches) ? proposal.edit.patches : [];
if (!patches.length) fail("Proposal-filen innehåller inga patchar.");
const threshold = Number(process.env.AUTO_PUBLISH_THRESHOLD || "0.97");
const autoMerge = proposal.decision === "auto_published";
const readyForHumanMerge = proposal.decision === "approved_on_merge";
if (autoMerge) {
  if (!proposal.review?.passed || proposal.review?.requiresHumanReview || Number(proposal.review?.score) < threshold) fail("Automatisk merge saknar godkänd kvalitetsgranskning.");
  if (!patches.every((patch) => typeof patch.sourceUrl === "string" && /^https?:\/\//i.test(patch.sourceUrl))) fail("Automatisk merge kräver källa för varje patch.");
  if (patches.some(patchNeedsHumanReview)) fail("Skyddade ändringar får inte mergas automatiskt.");
}

const reasons = Array.isArray(proposal.review?.reasons) ? proposal.review.reasons : [];
const sources = [...new Set(patches.map((patch) => patch.sourceUrl).filter(Boolean))];
const title = `${autoMerge ? "Automatiskt granskat förslag" : readyForHumanMerge ? "Granskningsförslag" : "Förslag som behöver utredas"}: ${proposal.area}`;
const body = [
  "## Agentförslag",
  "",
  `- **Område:** \`${proposal.area}\``,
  `- **Kvalitet:** ${Math.round(Number(proposal.review?.score || 0) * 100)} %`,
  `- **Beslut:** ${autoMerge ? "Automatisk merge efter tester" : readyForHumanMerge ? "Mänsklig granskning krävs" : "Ändringen är inte redo att mergas"}`,
  `- **Proposal:** \`${proposalFiles[0]}\``,
  "",
  "### Kvalitetsgranskarens bedömning",
  ...(reasons.length ? reasons.map((reason) => `- ${reason}`) : ["- Ingen motivering angavs."]),
  "",
  "### Källor",
  ...(sources.length ? sources.map((source) => `- ${source}`) : ["- Användarbidrag utan extern källa; måste granskas manuellt."]),
  "",
  autoMerge
    ? "Den här PR:n får endast mergas automatiskt om policykontroll, import, tester och produktionsbygge passerar."
    : readyForHumanMerge
      ? "Att merga PR:n är det uttryckliga mänskliga godkännandet. Publicerat innehåll ändras inte innan merge."
      : "Kvalitetsgranskaren har inte godkänt ändringen. Revidera proposal och innehållsdiff innan merge, eller stäng PR:n.",
].join("\n");

const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(output, `title=${title.replace(/[\r\n]/g, " ")}\n`);
  appendFileSync(output, `auto_merge=${autoMerge}\n`);
  appendFileSync(output, `ready_for_human_merge=${readyForHumanMerge}\n`);
  appendFileSync(output, `proposal_path=${proposalFiles[0]}\n`);
  appendFileSync(output, `body<<SVERIGEKLATTRAREN_EOF\n${body}\nSVERIGEKLATTRAREN_EOF\n`);
} else {
  process.stdout.write(JSON.stringify({ title, autoMerge, readyForHumanMerge, proposalPath: proposalFiles[0], body, changed }, null, 2));
}
