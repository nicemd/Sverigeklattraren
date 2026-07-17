import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { Area } from "./types";
import { repositoryRoot } from "./content";
import type { Intake, ProposedEdit, Review } from "./agents/schemas";

const runGit = (args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn("git", ["-c", `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`, ...args], { cwd: repositoryRoot, env: { ...process.env, GIT_AUTHOR_NAME: "Sverigeföraren agent", GIT_AUTHOR_EMAIL: "agent@sverigeforaren.local", GIT_COMMITTER_NAME: "Sverigeföraren agent", GIT_COMMITTER_EMAIL: "agent@sverigeforaren.local" } });
  let error = "";
  child.stderr.on("data", (chunk) => { error += String(chunk); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error || `git exited ${code}`)));
});

export async function publishProposal(area: Area, intake: Intake, edit: ProposedEdit, review: Review) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const threshold = Number(process.env.AUTO_PUBLISH_THRESHOLD || "0.97");
  const allCited = edit.patches.length > 0 && edit.patches.every((patch) => Boolean(patch.sourceUrl));
  const hasProtectedChange = edit.patches.some((patch) => patch.field === "access");
  const patchesAreApplicable = edit.patches.every((patch) => {
    if (patch.field === "description") return patch.value.trim().length >= 20;
    if (patch.field === "access") return true;
    try {
      const value = JSON.parse(patch.value);
      if (patch.field === "coordinates") return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.latitude >= -90 && value.latitude <= 90 && value.longitude >= -180 && value.longitude <= 180;
      return patch.field === "section" && typeof value.title === "string" && typeof value.body === "string" && value.title.trim().length > 0 && value.body.trim().length >= 20;
    } catch { return false; }
  });
  const autoPublish = review.passed && review.score >= threshold && allCited && patchesAreApplicable && !review.requiresHumanReview && !hasProtectedChange;
  const proposalDir = path.join(repositoryRoot, "proposals");
  await mkdir(proposalDir, { recursive: true });
  const proposalRelative = path.join("proposals", `${stamp}-${area.slug}.json`);
  await writeFile(path.join(repositoryRoot, proposalRelative), `${JSON.stringify({ schemaVersion: 1, createdAt: now.toISOString(), area: area.slug, intake, edit, review, decision: autoPublish ? "auto_published" : "needs_review" }, null, 2)}\n`, { flag: "wx" });

  const changed = [proposalRelative];
  if (autoPublish) {
    const areaRelative = path.join("content", "areas", `${area.slug}.json`);
    const manifestRelative = path.join("content", "areas.json");
    const updated: Area = JSON.parse(await readFile(path.join(repositoryRoot, areaRelative), "utf8"));
    for (const patch of edit.patches) {
      if (patch.field === "description") updated.description = patch.value;
      if (patch.field === "coordinates") {
        const coordinates = JSON.parse(patch.value);
        if (Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude)) updated.coordinates = coordinates;
      }
      if (patch.field === "section") {
        const section = JSON.parse(patch.value);
        const id = String(section.title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const index = updated.sections.findIndex((item) => item.id === id);
        const value = { id, title: String(section.title), body: String(section.body) };
        if (index === -1) updated.sections.push(value); else updated.sections[index] = value;
      }
      if (patch.sourceUrl && !updated.provenance.sources.some((source) => source.url === patch.sourceUrl)) {
        updated.provenance.sources.push({ id: `external:${stamp}`, title: patch.sourceUrl, url: patch.sourceUrl, importedAt: now.toISOString() });
      }
    }
    await writeFile(path.join(repositoryRoot, areaRelative), `${JSON.stringify(updated, null, 2)}\n`);
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, manifestRelative), "utf8"));
    const summary = manifest.find((item: { slug: string }) => item.slug === area.slug);
    if (!summary) throw new Error(`Området ${area.slug} saknas i manifestet.`);
    summary.description = updated.description;
    summary.coordinates = updated.coordinates;
    await writeFile(path.join(repositoryRoot, manifestRelative), `${JSON.stringify(manifest, null, 2)}\n`);
    changed.push(areaRelative, manifestRelative);
  }

  let committed = false;
  try {
    await runGit(["diff", "--cached", "--quiet"]);
    await runGit(["add", "--", ...changed]);
    await runGit(["commit", "-m", autoPublish ? `Uppdatera ${area.name} från granskat förslag` : `Spara ändringsförslag för ${area.name}`]);
    committed = true;
  } catch (error) {
    console.error("Proposal saved but Git commit failed", error);
  }
  return { autoPublished: autoPublish, committed, reviewScore: review.score };
}
