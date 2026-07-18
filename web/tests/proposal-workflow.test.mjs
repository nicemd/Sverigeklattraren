import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/proposal-pr-metadata.mjs");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function proposalRepository(proposal) {
  const root = await mkdtemp(path.join(os.tmpdir(), "proposal-workflow-"));
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.test");
  await writeFile(path.join(root, "README.md"), "base\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-b", "proposal/test");
  await mkdir(path.join(root, "proposals"), { recursive: true });
  await writeFile(path.join(root, "proposals", "test.json"), `${JSON.stringify(proposal, null, 2)}\n`);
  if (proposal.decision !== "needs_review") {
    await mkdir(path.join(root, "content", "areas"), { recursive: true });
    await writeFile(path.join(root, "content", "areas", `${proposal.area}.json`), "{}\n");
  }
  git(root, "add", ".");
  git(root, "commit", "-m", "proposal");
  return root;
}

const baseProposal = {
  schemaVersion: 2,
  area: "nacka-kvarn",
  workflow: { kind: "github_pull_request" },
  edit: { patches: [{ field: "description", value: "En tillräckligt lång redaktionell beskrivning.", rationale: "Redaktionellt", sourceUrl: null }] },
  review: { passed: false, score: 0.6, reasons: ["Mänsklig kontroll krävs."], requiresHumanReview: true },
  decision: "approved_on_merge",
};

test("accepts a human-review proposal branch without treating it as published", async () => {
  const root = await proposalRepository(baseProposal);
  try {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.autoMerge, false);
    assert.match(metadata.body, /mänskliga godkännandet/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects protected access information from automatic merge", async () => {
  const proposal = {
    ...baseProposal,
    decision: "auto_published",
    review: { passed: true, score: 1, reasons: [], requiresHumanReview: false },
    edit: { patches: [{ field: "access", value: "Parkering tillåten.", rationale: "Access", sourceUrl: "https://example.test/access" }] },
  };
  const root = await proposalRepository(proposal);
  try {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Skyddade ändringar/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a failed review as a non-publishable discussion PR", async () => {
  const proposal = { ...baseProposal, decision: "needs_review" };
  const root = await proposalRepository(proposal);
  try {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.autoMerge, false);
    assert.equal(metadata.readyForHumanMerge, false);
    assert.match(metadata.body, /inte redo att mergas/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});