"use client";

import { useEffect } from "react";

type SiteToolResult = {
  query: Record<string, string | number | null>;
  totalMatches: number;
  results: Array<{
    area: { name: string; slug: string; categories: string[] };
    sector: { id: string | null; name: string | null };
    route: { id: string; kind: "route" | "problem"; number: string | null; name: string; grade: string; length: string; type: string; description: string };
    source: { title: string; url: string };
  }>;
};

type SiteTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: SiteTool) => void | { unregister?: () => void };
  unregisterTool?: (name: string) => void;
};

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

const toolName = "search_climbing_routes";

function resultText(result: SiteToolResult) {
  if (result.totalMatches === 0) return "No documented routes matched the requested filters.";
  const rows = result.results.map(({ area, sector, route, source }) => {
    const number = route.number ? `${route.number}. ` : "";
    const context = [area.name, sector.name].filter(Boolean).join(" — ");
    const facts = [route.grade, route.type || (route.kind === "problem" ? "boulder" : "route"), route.length ? `${route.length} m` : ""].filter(Boolean).join(", ");
    return `${number}${route.name} (${facts}) — ${context}. Source: ${source.title} (${source.url})`;
  });
  const suffix = result.totalMatches > result.results.length ? `\nShowing ${result.results.length} of ${result.totalMatches} matches.` : "";
  return `${rows.join("\n")}${suffix}`;
}

export function SiteTools() {
  useEffect(() => {
    const modelContext = navigator.modelContext;
    if (!modelContext?.registerTool) return;

    let registration: void | { unregister?: () => void };
    try {
      registration = modelContext.registerTool({
        name: toolName,
        description: "Search Sverigeklättraren's sourced Swedish climbing guide. Use this for questions that list or find climbing routes/problems by exact grade, Swedish location/region, discipline or route type. Grade notation is case-sensitive: lowercase 8a is a roped French grade, while uppercase 8A is a Fontainebleau boulder grade. Results include area, sector, route number and source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            grade: { type: "string", description: "Exact grade, preserving case; for example 8a for a route or 8A for a boulder problem." },
            location: { type: "string", description: "Swedish city, county, region or area, for example Stockholm, Göteborg or Bohuslän." },
            discipline: { type: "string", description: "Optional discipline such as sport, trad, boulder, aid or ice." },
            kind: { type: "string", enum: ["route", "problem"], description: "Use route for roped climbing and problem for bouldering." },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        async execute(input) {
          const response = await fetch("/api/site-tools/routes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          });
          if (!response.ok) throw new Error(`Route search failed (${response.status}).`);
          const result = await response.json() as SiteToolResult;
          const resolvedResult = {
            ...result,
            results: result.results.map((entry) => ({
              ...entry,
              source: { ...entry.source, url: new URL(entry.source.url, window.location.origin).href },
            })),
          };
          const text = resultText(resolvedResult);
          return {
            content: [{ type: "text", text }],
            structuredContent: resolvedResult,
          };
        },
      });
    } catch {
      // WebMCP is progressive enhancement; an incompatible preview API must
      // never stop the climbing guide itself from rendering.
      return;
    }

    return () => {
      if (registration && typeof registration === "object" && registration.unregister) registration.unregister();
      else modelContext.unregisterTool?.(toolName);
    };
  }, []);

  return null;
}
