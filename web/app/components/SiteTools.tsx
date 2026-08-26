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
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: SiteTool) => void | { unregister?: () => void } | Promise<void | { unregister?: () => void }>;
  unregisterTool?: (name: string) => void;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
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
    let cancelled = false;
    let retryTimer: number | undefined;
    let registeredContext: ModelContext | undefined;
    let registration: void | { unregister?: () => void };

    const setStatus = (status: "waiting" | "registered" | "unsupported" | "error") => {
      document.documentElement.dataset.siteToolsStatus = status;
    };

    const register = async (attempt = 0) => {
      if (cancelled || registeredContext) return;
      // OpenAI Site Tools currently injects the page API on Document. Keep the
      // Navigator fallback for browsers implementing the earlier WebMCP draft.
      const modelContext = document.modelContext || navigator.modelContext;
      if (!modelContext?.registerTool) {
        if (attempt < 40) {
          setStatus("waiting");
          retryTimer = window.setTimeout(() => void register(attempt + 1), 250);
        } else setStatus("unsupported");
        return;
      }

      try {
        const resolvedRegistration = await modelContext.registerTool({
          name: toolName,
          title: "Search Swedish climbing routes",
          description: "Search Sverigeklättraren's sourced Swedish climbing guide. Use this for questions that list or find climbing routes/problems by exact grade, Swedish location/region, discipline or route type. Grade notation is case-sensitive: lowercase 8a is a roped French grade, while uppercase 8A is a Fontainebleau boulder grade. Results include area, sector, route number and source.",
          annotations: { readOnlyHint: true, untrustedContentHint: false },
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
        if (cancelled) {
          if (resolvedRegistration && typeof resolvedRegistration === "object" && resolvedRegistration.unregister) resolvedRegistration.unregister();
          else modelContext.unregisterTool?.(toolName);
          return;
        }
        registration = resolvedRegistration;
        registeredContext = modelContext;
        setStatus("registered");
      } catch (error) {
        setStatus("error");
        console.warn("WebMCP Site Tool registration failed", error);
      }
    };

    void register();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (registration && typeof registration === "object" && registration.unregister) registration.unregister();
      else registeredContext?.unregisterTool?.(toolName);
    };
  }, []);

  return null;
}
