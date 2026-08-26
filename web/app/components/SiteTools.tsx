"use client";

import { useEffect } from "react";

type SiteTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ToolRegistration = void | { unregister?: () => void };
type ModelContext = {
  registerTool: (tool: SiteTool) => ToolRegistration | Promise<ToolRegistration>;
  unregisterTool?: (name: string) => void;
};

declare global {
  interface Document { modelContext?: ModelContext }
  interface Navigator { modelContext?: ModelContext }
}

const readOnly = { readOnlyHint: true, untrustedContentHint: false };
const changesView = { readOnlyHint: false, untrustedContentHint: false };

async function fetchToolJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Site tool request failed (${response.status}).`);
  }
  return response.json();
}

function result(text: string, structuredContent: unknown) {
  return { content: [{ type: "text", text }], structuredContent };
}

function absolute(path: string) {
  return new URL(path, window.location.origin).href;
}

const siteTools: SiteTool[] = [
  {
    name: "search_climbing_routes",
    title: "Search Swedish climbing routes",
    description: "Search sourced Swedish routes and boulder problems by exact grade, location, discipline or kind. Use this to list or find climbs. Grade is case-sensitive: 8a is a roped French grade and 8A is a Fontainebleau boulder grade. Results contain stable area slugs and route IDs for the detail tools.",
    annotations: readOnly,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        grade: { type: "string", description: "Exact case-sensitive grade, such as 8a or 8A." },
        location: { type: "string", description: "Swedish city, county, region or area, such as Stockholm, Göteborg or Bohuslän." },
        discipline: { type: "string", description: "Discipline such as sport, trad, boulder, aid or ice." },
        kind: { type: "string", enum: ["route", "problem"], description: "route for roped climbing; problem for bouldering." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
    async execute(input) {
      const data = await fetchToolJson("/api/site-tools/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const resolved = {
        ...data,
        results: data.results.map((entry: Record<string, unknown> & { source: { url: string } }) => ({ ...entry, source: { ...entry.source, url: absolute(entry.source.url) } })),
      };
      const rows = resolved.results.map((entry: { area: { name: string; slug: string }; sector: { name: string | null }; route: { id: string; number: string | null; name: string; grade: string; type: string; kind: string; length: string }; source: { title: string; url: string } }) => {
        const number = entry.route.number ? `${entry.route.number}. ` : "";
        const facts = [entry.route.grade, entry.route.type || entry.route.kind, entry.route.length ? `${entry.route.length} m` : ""].filter(Boolean).join(", ");
        return `${number}${entry.route.name} (${facts}) — ${entry.area.name}${entry.sector.name ? ` / ${entry.sector.name}` : ""}. IDs: ${entry.area.slug}, ${entry.route.id}. Source: ${entry.source.title} (${entry.source.url})`;
      });
      return result(rows.length ? `${rows.join("\n")}\n${resolved.totalMatches} total matches.` : "No documented climbs matched the filters.", resolved);
    },
  },
  {
    name: "search_climbing_areas",
    title: "Search Swedish climbing areas",
    description: "Find Swedish climbing areas by name, region, discipline and practical data availability. Use before area, sector, access or comparison tools when an area slug is unknown. With no filters, returns the largest documented areas.",
    annotations: readOnly,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        query: { type: "string", description: "Area name or general search text." },
        location: { type: "string", description: "Swedish city, county or region." },
        discipline: { type: "string", description: "sport, trad, boulder, ice or another discipline." },
        minRoutes: { type: "integer", minimum: 0, maximum: 10000 },
        hasCoordinates: { type: "boolean", description: "Only areas with map coordinates." },
        hasAccess: { type: "boolean", description: "Only areas connected to the Swedish Climbing Federation access database." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
    },
    async execute(input) {
      const data = await fetchToolJson("/api/site-tools/areas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const rows = data.results.map((area: { name: string; slug: string; routeCount: number; imageCount: number; categories: string[]; currentAccessAvailable: boolean }) => `${area.name} [${area.slug}] — ${area.routeCount} climbs, ${area.imageCount} images; ${area.categories.join(", ") || "uncategorized"}; current access source: ${area.currentAccessAvailable ? "yes" : "no"}.`);
      return result(rows.length ? `${rows.join("\n")}\n${data.totalMatches} total matches.` : "No climbing areas matched the filters.", data);
    },
  },
  {
    name: "get_climbing_area",
    title: "Get climbing area field guide",
    description: "Get a sourced field overview for one area: coordinates, directions, sectors, overview maps, route count, historical access note, quality issues and sources. Use get_current_climbing_access separately for live access status.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlug"], properties: { areaSlug: { type: "string", description: "Stable slug returned by search_climbing_areas or search_climbing_routes." } } },
    async execute(input) {
      const data = await fetchToolJson(`/api/site-tools/areas/${encodeURIComponent(String(input.areaSlug))}`);
      const resolved = { ...data, overviewImages: data.overviewImages.map((image: { url: string }) => ({ ...image, url: absolute(image.url) })), sources: data.sources.map((source: { url: string }) => ({ ...source, url: absolute(source.url) })) };
      const sectors = resolved.sectors.map((sector: { id: string; name: string; routeCount: number }) => `${sector.name} [${sector.id}] (${sector.routeCount})`).join(", ");
      return result(`${resolved.name}: ${resolved.description}\nCoordinates: ${resolved.coordinates ? `${resolved.coordinates.latitude}, ${resolved.coordinates.longitude}` : "missing"}.\nDirections: ${resolved.directions?.body || "missing"}.\nSectors: ${sectors || "none structured"}.\nCurrent access source connected: ${resolved.currentAccessAvailable ? "yes" : "no"}.`, resolved);
    },
  },
  {
    name: "get_climbing_route",
    title: "Get a climbing route field card",
    description: "Get one sourced route/problem with number, grade, type, length, first ascent, route description, sector and linked topos. Beta is hidden unless includeBeta is true; only set it when the user explicitly asks to see beta.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlug", "routeId"], properties: {
      areaSlug: { type: "string" }, routeId: { type: "string" }, includeBeta: { type: "boolean", default: false, description: "Reveal movement beta only after an explicit user request." },
    } },
    async execute(input) {
      const includeBeta = input.includeBeta === true;
      const data = await fetchToolJson(`/api/site-tools/routes/${encodeURIComponent(String(input.areaSlug))}/${encodeURIComponent(String(input.routeId))}?includeBeta=${includeBeta}`);
      const resolved = { ...data, relatedTopos: data.relatedTopos.map((topo: { url: string }) => ({ ...topo, url: absolute(topo.url) })), sources: data.sources.map((source: { url: string }) => ({ ...source, url: absolute(source.url) })) };
      const route = resolved.route;
      return result(`${route.number ? `${route.number}. ` : ""}${route.name}, ${route.grade}${route.type ? ` ${route.type}` : ""}${route.length ? `, ${route.length} m` : ""} — ${resolved.area.name}${resolved.sector ? ` / ${resolved.sector.name}` : ""}.\nRoute description: ${route.description || "missing"}.${resolved.betaIncluded ? `\nBeta: ${route.beta}` : "\nBeta not included."}\nLinked topos: ${resolved.relatedTopos.length}.`, resolved);
    },
  },
  {
    name: "get_current_climbing_access",
    title: "Check current climbing access",
    description: "Check access, closures, parking or sensitive conditions for one area. Prefers the Swedish Climbing Federation access database and returns both the source update time and local fetch time. Never present a historical fallback as current.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlug"], properties: { areaSlug: { type: "string" } } },
    async execute(input) {
      const data = await fetchToolJson(`/api/site-tools/access/${encodeURIComponent(String(input.areaSlug))}`);
      const resolved = { ...data, current: data.current ? { ...data.current, url: absolute(data.current.url) } : null };
      const text = resolved.current
        ? `${resolved.area.name}: ${resolved.current.status}. ${resolved.current.summary}\nAuthoritative source: ${resolved.current.url}. Source updated: ${resolved.current.sourceUpdatedAt || "unknown"}; fetched: ${resolved.current.fetchedAt}.`
        : `${resolved.area.name}: no current access result is available. ${resolved.warning}${resolved.legacy ? ` Historical 2014 note (not current): ${resolved.legacy.summary}` : ""}`;
      return result(text, resolved);
    },
  },
  {
    name: "get_climbing_sector",
    title: "Get sector routes and topos",
    description: "Get a sector as it is needed at the crag: sector description, ordered routes with descriptions, and the topos linked to those routes. Use areaSlug and sectorId from get_climbing_area or route search results.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlug", "sectorId"], properties: { areaSlug: { type: "string" }, sectorId: { type: "string" }, offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 100 } } },
    async execute(input) {
      const offset = Number.isInteger(input.offset) ? Number(input.offset) : 0;
      const limit = Number.isInteger(input.limit) ? Number(input.limit) : 100;
      const data = await fetchToolJson(`/api/site-tools/sectors/${encodeURIComponent(String(input.areaSlug))}/${encodeURIComponent(String(input.sectorId))}?offset=${offset}&limit=${limit}`);
      const resolved = { ...data, topos: data.topos.map((topo: { url: string }) => ({ ...topo, url: absolute(topo.url) })), sources: data.sources.map((source: { url: string }) => ({ ...source, url: absolute(source.url) })) };
      const routes = resolved.routes.map((route: { number: string | null; name: string; grade: string; type: string; description: string }) => `${route.number ? `${route.number}. ` : ""}${route.name}, ${route.grade}${route.type ? ` ${route.type}` : ""}${route.description ? ` — ${route.description}` : ""}`).join("\n");
      const pageNote = resolved.totalRoutes > resolved.routes.length ? ` Showing ${resolved.offset + 1}–${resolved.offset + resolved.routes.length} of ${resolved.totalRoutes} routes.` : "";
      return result(`${resolved.area.name} / ${resolved.sector.name}: ${resolved.sector.description || "No sector description."}\n${routes || "No structured routes."}\nLinked topos: ${resolved.topos.length}.${pageNote}`, resolved);
    },
  },
  {
    name: "find_nearby_climbing",
    title: "Find climbing near coordinates",
    description: "Find documented Swedish climbing areas within a straight-line radius of coordinates, sorted nearest first. Use coordinates supplied by the user or obtained with their permission; this tool does not read device location.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["latitude", "longitude"], properties: {
      latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 }, radiusKm: { type: "number", minimum: 1, maximum: 500, default: 50 }, discipline: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    } },
    async execute(input) {
      const data = await fetchToolJson("/api/site-tools/nearby", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const rows = data.results.map((area: { name: string; slug: string; distanceKm: number; routeCount: number; categories: string[] }) => `${area.distanceKm} km — ${area.name} [${area.slug}], ${area.routeCount} climbs; ${area.categories.join(", ")}.`);
      return result(rows.length ? `${rows.join("\n")}\n${data.totalMatches} areas within the radius.` : "No documented climbing areas were found within the radius.", data);
    },
  },
  {
    name: "compare_climbing_areas",
    title: "Compare climbing areas",
    description: "Compare 2–6 areas for trip planning using route, sector and topo counts, grade and discipline distributions, coordinate/access availability and known data-quality issues. Obtain exact slugs with search_climbing_areas first.",
    annotations: readOnly,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlugs"], properties: { areaSlugs: { type: "array", minItems: 2, maxItems: 6, uniqueItems: true, items: { type: "string" } } } },
    async execute(input) {
      const data = await fetchToolJson("/api/site-tools/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const resolved = { ...data, areas: data.areas.map((area: { sources: Array<{ url: string }> }) => ({ ...area, sources: area.sources.map((source) => ({ ...source, url: absolute(source.url) })) })) };
      const rows = resolved.areas.map((area: { name: string; routeCount: number; sectorCount: number; topoCount: number; routesLinkedToTopos: number; currentAccessAvailable: boolean; disciplineDistribution: Record<string, number> }) => `${area.name}: ${area.routeCount} climbs, ${area.sectorCount} sectors, ${area.topoCount} topos, ${area.routesLinkedToTopos} topo-linked climbs; access source ${area.currentAccessAvailable ? "connected" : "not connected"}; disciplines ${Object.entries(area.disciplineDistribution).map(([name, count]) => `${name} ${count}`).join(", ")}.`);
      return result(`${rows.join("\n")}${resolved.missing.length ? `\nUnknown slugs: ${resolved.missing.join(", ")}.` : ""}`, resolved);
    },
  },
  {
    name: "show_climbing_on_page",
    title: "Show climbing area or route on the page",
    description: "Open an area in the visible Sverigeklättraren interface and optionally filter its route list to a route name. This changes only the current page view and does not modify guide data.",
    annotations: changesView,
    inputSchema: { type: "object", additionalProperties: false, required: ["areaSlug"], properties: { areaSlug: { type: "string" }, routeQuery: { type: "string", description: "Optional route name or route number to reveal in the area route list." } } },
    async execute(input) {
      const detail = { areaSlug: String(input.areaSlug), routeQuery: typeof input.routeQuery === "string" ? input.routeQuery : "" };
      window.dispatchEvent(new CustomEvent("sverigeklattraren:show-climbing", { detail }));
      return result(`Opened ${detail.areaSlug}${detail.routeQuery ? ` and filtered routes by ${detail.routeQuery}` : ""} in the visible page.`, detail);
    },
  },
];

export function SiteTools() {
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let registeredContext: ModelContext | undefined;
    let registrations: Array<{ name: string; registration: ToolRegistration }> = [];

    const setStatus = (status: "waiting" | "registered" | "unsupported" | "error") => {
      document.documentElement.dataset.siteToolsStatus = status;
      document.documentElement.dataset.siteToolsCount = status === "registered" ? String(siteTools.length) : "0";
    };
    const unregister = (modelContext: ModelContext, values: typeof registrations) => {
      for (const value of values) {
        if (value.registration && typeof value.registration === "object" && value.registration.unregister) value.registration.unregister();
        else modelContext.unregisterTool?.(value.name);
      }
    };

    const register = async (attempt = 0) => {
      if (cancelled || registeredContext) return;
      const modelContext = document.modelContext || navigator.modelContext;
      if (!modelContext?.registerTool) {
        if (attempt < 40) {
          setStatus("waiting");
          retryTimer = window.setTimeout(() => void register(attempt + 1), 250);
        } else setStatus("unsupported");
        return;
      }

      const resolved: typeof registrations = [];
      try {
        for (const tool of siteTools) resolved.push({ name: tool.name, registration: await modelContext.registerTool(tool) });
        if (cancelled) {
          unregister(modelContext, resolved);
          return;
        }
        registrations = resolved;
        registeredContext = modelContext;
        setStatus("registered");
      } catch (error) {
        unregister(modelContext, resolved);
        setStatus("error");
        console.warn("WebMCP Site Tool registration failed", error);
      }
    };

    void register();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (registeredContext) unregister(registeredContext, registrations);
    };
  }, []);

  return null;
}
