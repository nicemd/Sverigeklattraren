import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import { contentRoot, getArea, getAreaSummaries } from "./content";
import type { Area, Route, SourceReference } from "./types";

export type RouteSearchQuery = {
  grade?: string;
  location?: string;
  discipline?: string;
  kind?: "route" | "problem";
  limit?: number;
};

export type RouteSearchResult = {
  area: { name: string; slug: string; categories: string[] };
  sector: { id: string | null; name: string | null };
  route: Pick<Route, "id" | "kind" | "number" | "name" | "grade" | "length" | "type" | "description">;
  source: { title: string; url: string };
};

type IndexedRoute = RouteSearchResult & {
  locationText: string;
  disciplineText: string;
};

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sv").replace(/[^a-z0-9åäö]+/g, " ").trim();
}

function sourceFor(area: Area, route: Route): SourceReference | undefined {
  return area.provenance.sources.find((source) => source.id === route.source.id)
    || area.provenance.sources.find((source) => source.id === area.provenance.primarySourceId);
}

let routeIndexCache: { version: string; value: Promise<IndexedRoute[]> } | null = null;

async function buildRouteIndex(): Promise<IndexedRoute[]> {
  const summaries = await getAreaSummaries();
  const areas = await Promise.all(summaries.map((summary) => getArea(summary.slug)));

  return areas.flatMap((area) => {
    if (!area) return [];
    const sectors = new Map(area.sections.map((section) => [section.id, section.title]));
    // Location must come from the area's identity/taxonomy. Descriptions often
    // mention other cities in historical notes and must not create false hits.
    const locationText = normalizedText(`${area.name} ${area.categories.join(" ")}`);

    return area.routes.map((route): IndexedRoute => {
      const source = sourceFor(area, route);
      return {
        area: { name: area.name, slug: area.slug, categories: area.categories },
        sector: { id: route.sectorId, name: route.sectorId ? sectors.get(route.sectorId) || null : null },
        route: {
          id: route.id,
          kind: route.kind,
          number: route.number,
          name: route.name,
          grade: route.grade,
          length: route.length,
          type: route.type,
          description: route.description,
        },
        source: {
          title: source?.title || "Sverigeföraren 2014",
          url: source?.url || `/api/source/${area.slug}`,
        },
        locationText,
        disciplineText: normalizedText(`${route.type} ${route.kind} ${area.categories.join(" ")}`),
      };
    });
  });
}

async function getRouteIndex() {
  const manifest = await stat(path.join(contentRoot, "areas.json"));
  const version = `${manifest.mtimeMs}:${manifest.size}`;
  if (!routeIndexCache || routeIndexCache.version !== version) {
    routeIndexCache = { version, value: buildRouteIndex() };
  }
  return routeIndexCache.value;
}

export async function searchClimbingRoutes(query: RouteSearchQuery) {
  const grade = query.grade?.trim() || "";
  const location = normalizedText(query.location || "");
  const discipline = normalizedText(query.discipline || "");
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit || 50)));
  const index = await getRouteIndex();

  const matches = index.filter((entry) => {
    if (grade && entry.route.grade.trim() !== grade) return false;
    if (location && !entry.locationText.includes(location)) return false;
    if (discipline && !entry.disciplineText.includes(discipline)) return false;
    if (query.kind && entry.route.kind !== query.kind) return false;
    return true;
  }).sort((left, right) => left.area.name.localeCompare(right.area.name, "sv")
    || (left.sector.name || "").localeCompare(right.sector.name || "", "sv")
    || (left.route.number || "").localeCompare(right.route.number || "", "sv", { numeric: true })
    || left.route.name.localeCompare(right.route.name, "sv"));

  return {
    query: {
      grade: grade || null,
      location: query.location?.trim() || null,
      discipline: query.discipline?.trim() || null,
      kind: query.kind || null,
      limit,
    },
    totalMatches: matches.length,
    results: matches.slice(0, limit).map((entry) => ({
      area: entry.area,
      sector: entry.sector,
      route: entry.route,
      source: entry.source,
    })),
  };
}
