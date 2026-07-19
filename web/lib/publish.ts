import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Area } from "./types";
import { contentRoot } from "./content";
import type { Intake, ProposedEdit, Review } from "./agents/schemas";
import { patchNeedsHumanReview } from "./publication-policy.mjs";
import { pushProposalBranch, type ProposalFile } from "./github-publish";

const routeFactFields = new Set(["name", "grade", "number", "length", "type", "firstAscent", "description", "beta", "sectorId"]);

function patchIsApplicable(area: Area, patch: ProposedEdit["patches"][number]) {
  if (patch.field === "description") return patch.value.trim().length >= 20;
  if (patch.field === "access") return true;
  try {
    const value = JSON.parse(patch.value);
    if (patch.field === "coordinates") return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.latitude >= -90 && value.latitude <= 90 && value.longitude >= -180 && value.longitude <= 180;
    if (patch.field === "route_fact") {
      const fields = value.facts && typeof value.facts === "object" ? Object.keys(value.facts) : [];
      return ["route", "problem"].includes(value.kind)
        && typeof value.sectorId === "string"
        && area.sections.some((section) => section.id === value.sectorId)
        && fields.length > 0
        && fields.every((field) => routeFactFields.has(field))
        && (typeof value.routeId === "string" || typeof value.facts.name === "string");
    }
    return patch.field === "section" && typeof value.title === "string" && typeof value.body === "string" && value.title.trim().length > 0 && value.body.trim().length >= 20;
  } catch {
    return false;
  }
}

function hasConflictingRouteFact(area: Area, edit: ProposedEdit) {
  return edit.patches.some((patch) => {
    if (patch.field !== "route_fact") return false;
    try {
      const value = JSON.parse(patch.value) as { routeId?: string; sectorId: string; facts?: Record<string, unknown> };
      const route = value.routeId
        ? area.routes.find((item) => item.id === value.routeId)
        : area.routes.find((item) => item.sectorId === value.sectorId && item.name.toLocaleLowerCase("sv") === String(value.facts?.name || "").toLocaleLowerCase("sv"));
      if (!route) return false;
      if (route.sectorId && route.sectorId !== value.sectorId) return true;
      return Object.entries(value.facts || {}).some(([field, fact]) => {
        if (!routeFactFields.has(field) || fact === null || typeof fact !== "string") return false;
        const current = (route as unknown as Record<string, unknown>)[field];
        return typeof current === "string" && current.trim().length > 0 && current.trim() !== fact.trim();
      });
    } catch {
      return false;
    }
  });
}

async function buildContentFiles(area: Area, edit: ProposedEdit, stamp: string) {
  const areaRelative = path.posix.join("content", "areas", `${area.slug}.json`);
  const manifestRelative = path.posix.join("content", "areas.json");
  const updated: Area = JSON.parse(await readFile(path.join(contentRoot, "areas", `${area.slug}.json`), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(contentRoot, "areas.json"), "utf8"));
  let changed = false;

  for (const [patchIndex, patch] of edit.patches.entries()) {
    if (!patchIsApplicable(area, patch) || patch.field === "access") continue;
    let sourceId: string;
    if (patch.sourceUrl) {
      const existingSource = updated.provenance.sources.find((source) => source.url === patch.sourceUrl);
      sourceId = existingSource?.id || `external:${stamp}:${patchIndex + 1}`;
      if (!existingSource) updated.provenance.sources.push({
        id: sourceId,
        title: new URL(patch.sourceUrl).hostname,
        url: patch.sourceUrl,
        importedAt: new Date().toISOString(),
        usage: "fact-reference",
        rightsNote: "Endast faktapåståenden har hämtats; formuleringar, bilder och topos återpubliceras inte.",
      });
    } else {
      sourceId = `firsthand:${stamp}:${patchIndex + 1}`;
      updated.provenance.sources.push({
        id: sourceId,
        title: "Användarförslag via Sverigeklättraren",
        importedAt: new Date().toISOString(),
        usage: "firsthand",
        rightsNote: "Bidraget publiceras under förarinnehållets öppna licens efter GitHub-granskning.",
      });
    }

    if (patch.field === "description") {
      updated.description = patch.value;
      changed = true;
    }
    if (patch.field === "coordinates") {
      updated.coordinates = JSON.parse(patch.value);
      changed = true;
    }
    if (patch.field === "section") {
      const section = JSON.parse(patch.value);
      const id = String(section.title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const index = updated.sections.findIndex((item) => item.id === id);
      const value = { id, title: String(section.title), body: String(section.body) };
      if (index === -1) updated.sections.push(value); else updated.sections[index] = value;
      changed = true;
    }
    if (patch.field === "route_fact") {
      const value = JSON.parse(patch.value) as { routeId?: string; kind: "route" | "problem"; sectorId: string; facts: Record<string, string | null> };
      let route = value.routeId ? updated.routes.find((item) => item.id === value.routeId) : undefined;
      if (!route && value.facts.name) route = updated.routes.find((item) => item.sectorId === value.sectorId && item.name.toLocaleLowerCase("sv") === String(value.facts.name).toLocaleLowerCase("sv"));
      if (!route) {
        const routeId = `${area.slug}-${value.kind}-external-${String(value.facts.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
        route = { id: routeId, kind: value.kind, number: null, name: String(value.facts.name), grade: "", length: "", type: "", firstAscent: "", description: "", sectorId: value.sectorId, source: { id: sourceId, url: patch.sourceUrl || undefined }, fieldSources: {} };
        updated.routes.push(route);
      }
      route.fieldSources ||= {};
      for (const [field, fact] of Object.entries(value.facts)) {
        if (!routeFactFields.has(field) || (fact !== null && typeof fact !== "string")) continue;
        (route as unknown as Record<string, unknown>)[field] = fact;
        const fieldSources = route.fieldSources as Record<string, string[]>;
        fieldSources[field] = [...new Set([...(fieldSources[field] || []), sourceId])];
      }
      changed = true;
    }
  }

  if (!changed) return [] as ProposalFile[];
  const summary = manifest.find((item: { slug: string }) => item.slug === area.slug);
  if (!summary) throw new Error(`Området ${area.slug} saknas i manifestet.`);
  summary.description = updated.description;
  summary.coordinates = updated.coordinates;
  summary.routeCount = updated.routes.length;
  summary.searchText = updated.routes.map((route) => `${route.name} ${route.grade}`).join(" ");
  return [
    { path: areaRelative, content: `${JSON.stringify(updated, null, 2)}\n` },
    { path: manifestRelative, content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
}

export async function publishProposal(area: Area, intake: Intake, edit: ProposedEdit, review: Review) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const threshold = Number(process.env.AUTO_PUBLISH_THRESHOLD || "0.97");
  const allCited = edit.patches.length > 0 && edit.patches.every((patch) => Boolean(patch.sourceUrl));
  const hasProtectedChange = edit.patches.some(patchNeedsHumanReview);
  const patchesAreApplicable = edit.patches.length > 0 && edit.patches.every((patch) => patchIsApplicable(area, patch));
  const conflictingRouteFact = hasConflictingRouteFact(area, edit);
  const autoMergeEligible = review.passed && review.score >= threshold && allCited && patchesAreApplicable && !review.requiresHumanReview && !hasProtectedChange && !conflictingRouteFact;
  const contentFiles = patchesAreApplicable && review.passed ? await buildContentFiles(area, edit, stamp) : [];
  const readyForHumanMerge = !autoMergeEligible && review.passed && contentFiles.length > 0;
  const decision = autoMergeEligible ? "auto_published" : readyForHumanMerge ? "approved_on_merge" : "needs_review";
  const proposalRelative = path.posix.join("proposals", `${stamp}-${area.slug}.json`);
  const proposal = {
    schemaVersion: 2,
    createdAt: now.toISOString(),
    area: area.slug,
    intake,
    edit,
    review,
    decision,
    workflow: {
      kind: "github_pull_request",
      mergePolicy: autoMergeEligible ? "automatic_after_checks" : readyForHumanMerge ? "human_review_required" : "revision_required",
    },
  };
  const files: ProposalFile[] = [
    { path: proposalRelative, content: `${JSON.stringify(proposal, null, 2)}\n` },
    ...contentFiles,
  ];
  const pushed = await pushProposalBranch(
    area.slug,
    stamp,
    autoMergeEligible ? `Föreslå automatiskt granskad uppdatering av ${area.name}` : `Föreslå uppdatering av ${area.name}`,
    files,
  );
  return {
    autoMergeEligible,
    reviewScore: review.score,
    readyForHumanMerge,
    pullRequestUrl: pushed.pullRequestUrl,
    pullRequestNumber: pushed.pullRequestNumber,
    branch: pushed.branch,
    branchUrl: pushed.branchUrl,
  };
}
