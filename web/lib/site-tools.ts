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

export type AreaSearchQuery = {
  query?: string;
  location?: string;
  discipline?: string;
  minRoutes?: number;
  hasCoordinates?: boolean;
  hasAccess?: boolean;
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

function sourceResult(area: Area, source: SourceReference) {
  return {
    id: source.id,
    title: source.title,
    url: source.url || `/api/source/${area.slug}`,
    license: source.license || null,
    snapshotDate: source.snapshotDate || null,
    sourceModifiedAt: source.sourceModifiedAt || null,
    importedAt: source.importedAt || null,
    usage: source.usage || null,
  };
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

export async function searchClimbingAreas(query: AreaSearchQuery) {
  const text = normalizedText(query.query || "");
  const location = normalizedText(query.location || "");
  const discipline = normalizedText(query.discipline || "");
  const minRoutes = Math.max(0, Math.trunc(query.minRoutes || 0));
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit || 25)));
  const summaries = await getAreaSummaries();

  const matches = summaries.filter((area) => {
    const identity = normalizedText(`${area.name} ${area.categories.join(" ")}`);
    const searchable = normalizedText(`${area.name} ${area.description} ${area.categories.join(" ")} ${area.searchText}`);
    if (text && !searchable.includes(text)) return false;
    if (location && !identity.includes(location)) return false;
    if (discipline && !searchable.includes(discipline)) return false;
    if (area.routeCount < minRoutes) return false;
    if (query.hasCoordinates === true && (area.coordinates?.latitude == null || area.coordinates.longitude == null)) return false;
    if (query.hasAccess === true && !area.accessSlug) return false;
    return true;
  }).sort((left, right) => {
    const leftName = normalizedText(left.name);
    const rightName = normalizedText(right.name);
    const leftRank = text && leftName === text ? 0 : text && leftName.startsWith(text) ? 1 : 2;
    const rightRank = text && rightName === text ? 0 : text && rightName.startsWith(text) ? 1 : 2;
    return leftRank - rightRank || right.routeCount - left.routeCount || left.name.localeCompare(right.name, "sv");
  });

  return {
    query: {
      query: query.query?.trim() || null,
      location: query.location?.trim() || null,
      discipline: query.discipline?.trim() || null,
      minRoutes,
      hasCoordinates: query.hasCoordinates ?? null,
      hasAccess: query.hasAccess ?? null,
      limit,
    },
    totalMatches: matches.length,
    results: matches.slice(0, limit).map((area) => ({
      slug: area.slug,
      name: area.name,
      description: area.description,
      categories: area.categories,
      coordinates: area.coordinates,
      routeCount: area.routeCount,
      imageCount: area.imageCount,
      currentAccessAvailable: Boolean(area.accessSlug),
    })),
  };
}

export async function getClimbingAreaDetails(slug: string) {
  const area = await getArea(slug);
  if (!area) return null;
  const directions = area.sections.find((section) => /vägbeskrivning|hitta hit|anmarsch/i.test(section.title));
  const sectorCounts = new Map<string, number>();
  for (const route of area.routes) {
    if (route.sectorId) sectorCounts.set(route.sectorId, (sectorCounts.get(route.sectorId) || 0) + 1);
  }
  const overviewImages = area.images.filter((image) => image.imageKind === "map").map((image) => ({
    filename: image.filename,
    caption: image.caption,
    url: `/api/media/${encodeURIComponent(image.filename)}`,
  }));

  return {
    slug: area.slug,
    name: area.name,
    description: area.description,
    categories: area.categories,
    coordinates: area.coordinates,
    mapsUrl: area.coordinates?.latitude != null && area.coordinates.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${area.coordinates.latitude},${area.coordinates.longitude}`
      : null,
    directions: directions ? { title: directions.title, body: directions.body, source: "Sverigeföraren 2014" } : null,
    legacyAccess: area.access.legacyText,
    currentAccessAvailable: Boolean(area.access.federationSlug),
    routeCount: area.routes.length,
    sectors: area.sections.filter((section) => sectorCounts.has(section.id)).map((section) => ({
      id: section.id,
      name: section.title,
      description: section.body,
      routeCount: sectorCounts.get(section.id) || 0,
    })),
    overviewImages,
    qualityIssues: area.qualityIssues,
    sources: area.provenance.sources.map((source) => sourceResult(area, source)),
  };
}

export async function getClimbingRouteDetails(areaSlug: string, routeId: string, includeBeta = false) {
  const area = await getArea(areaSlug);
  if (!area) return null;
  const route = area.routes.find((item) => item.id === routeId);
  if (!route) return null;
  const sector = route.sectorId ? area.sections.find((section) => section.id === route.sectorId) : null;
  const sourceIds = new Set([
    route.source.id,
    ...Object.values(route.fieldSources || {}).flatMap((ids) => ids || []),
  ]);
  const relatedTopos = area.images.flatMap((image) => {
    const relation = image.routeRelations?.find((item) => item.routeId === route.id);
    if (!relation && !image.routeIds?.includes(route.id)) return [];
    return [{
      filename: image.filename,
      caption: image.caption,
      url: `/api/media/${encodeURIComponent(image.filename)}`,
      relation: relation || { method: "source-order", confidence: 0.72, evidence: "The image and route share source context." },
    }];
  });

  return {
    area: { slug: area.slug, name: area.name },
    sector: sector ? { id: sector.id, name: sector.title, description: sector.body } : null,
    route: {
      id: route.id,
      kind: route.kind,
      number: route.number,
      name: route.name,
      grade: route.grade,
      length: route.length,
      type: route.type,
      firstAscent: route.firstAscent,
      description: route.description,
      ...(includeBeta && route.beta ? { beta: route.beta } : {}),
    },
    betaIncluded: Boolean(includeBeta && route.beta),
    relatedTopos,
    sources: area.provenance.sources.filter((source) => sourceIds.has(source.id)).map((source) => sourceResult(area, source)),
  };
}

export async function getClimbingSectorGuide(areaSlug: string, sectorId: string, offset = 0, limit = 100) {
  const area = await getArea(areaSlug);
  if (!area) return null;
  const sector = area.sections.find((section) => section.id === sectorId);
  if (!sector) return null;
  const routes = area.routes.filter((route) => route.sectorId === sectorId);
  const safeOffset = Math.max(0, Math.trunc(offset));
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const routeIds = new Set(routes.map((route) => route.id));
  const images = area.images.filter((image) => image.sectorId === sectorId
    || image.routeIds?.some((routeId) => routeIds.has(routeId))
    || image.routeRelations?.some((relation) => routeIds.has(relation.routeId)));

  return {
    area: { slug: area.slug, name: area.name },
    sector: { id: sector.id, name: sector.title, description: sector.body },
    totalRoutes: routes.length,
    offset: safeOffset,
    limit: safeLimit,
    routes: routes.slice(safeOffset, safeOffset + safeLimit).map((route) => ({
      id: route.id,
      kind: route.kind,
      number: route.number,
      name: route.name,
      grade: route.grade,
      length: route.length,
      type: route.type,
      description: route.description,
    })),
    topos: images.map((image) => ({
      filename: image.filename,
      caption: image.caption,
      imageKind: image.imageKind || "unknown",
      url: `/api/media/${encodeURIComponent(image.filename)}`,
      routeIds: [...new Set([
        ...(image.routeIds || []),
        ...(image.routeRelations || []).map((relation) => relation.routeId),
      ])].filter((routeId) => routeIds.has(routeId)),
    })),
    sources: area.provenance.sources.map((source) => sourceResult(area, source)),
  };
}

function distanceKm(latitude1: number, longitude1: number, latitude2: number, longitude2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function findNearbyClimbingAreas(latitude: number, longitude: number, radiusKm = 50, discipline = "", limit = 25) {
  const normalizedDiscipline = normalizedText(discipline);
  const safeRadius = Math.max(1, Math.min(500, radiusKm));
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const summaries = await getAreaSummaries();
  const matches = summaries.flatMap((area) => {
    if (area.coordinates?.latitude == null || area.coordinates.longitude == null) return [];
    const searchable = normalizedText(`${area.name} ${area.description} ${area.categories.join(" ")} ${area.searchText}`);
    if (normalizedDiscipline && !searchable.includes(normalizedDiscipline)) return [];
    const distance = distanceKm(latitude, longitude, area.coordinates.latitude, area.coordinates.longitude);
    if (distance > safeRadius) return [];
    return [{
      slug: area.slug,
      name: area.name,
      distanceKm: Math.round(distance * 10) / 10,
      coordinates: area.coordinates,
      categories: area.categories,
      routeCount: area.routeCount,
      imageCount: area.imageCount,
      currentAccessAvailable: Boolean(area.accessSlug),
    }];
  }).sort((left, right) => left.distanceKm - right.distanceKm || right.routeCount - left.routeCount);

  return {
    query: { latitude, longitude, radiusKm: safeRadius, discipline: discipline || null, limit: safeLimit },
    totalMatches: matches.length,
    results: matches.slice(0, safeLimit),
  };
}

function areaComparison(area: Area) {
  const linkedRouteIds = new Set(area.images.flatMap((image) => [
    ...(image.routeIds || []),
    ...(image.routeRelations || []).map((relation) => relation.routeId),
  ]));
  const grades = new Map<string, number>();
  const disciplines = new Map<string, number>();
  for (const route of area.routes) {
    if (route.grade) grades.set(route.grade, (grades.get(route.grade) || 0) + 1);
    const discipline = route.type || (route.kind === "problem" ? "boulder" : "unspecified");
    disciplines.set(discipline, (disciplines.get(discipline) || 0) + 1);
  }
  return {
    slug: area.slug,
    name: area.name,
    description: area.description,
    categories: area.categories,
    coordinates: area.coordinates,
    routeCount: area.routes.length,
    sectorCount: new Set(area.routes.map((route) => route.sectorId).filter(Boolean)).size,
    topoCount: area.images.filter((image) => image.imageKind === "topo").length,
    routesLinkedToTopos: linkedRouteIds.size,
    currentAccessAvailable: Boolean(area.access.federationSlug),
    gradeDistribution: Object.fromEntries([...grades].sort(([left], [right]) => left.localeCompare(right, "sv", { numeric: true }))),
    disciplineDistribution: Object.fromEntries([...disciplines].sort(([left], [right]) => left.localeCompare(right, "sv"))),
    qualityIssues: area.qualityIssues,
    sources: area.provenance.sources.map((source) => sourceResult(area, source)),
  };
}

export async function compareClimbingAreas(slugs: string[]) {
  const uniqueSlugs = [...new Set(slugs)].slice(0, 6);
  const areas = await Promise.all(uniqueSlugs.map((slug) => getArea(slug)));
  return {
    requested: uniqueSlugs,
    missing: uniqueSlugs.filter((_slug, index) => !areas[index]),
    areas: areas.filter((area): area is Area => Boolean(area)).map(areaComparison),
  };
}
