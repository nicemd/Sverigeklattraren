import "server-only";
import { cache } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Area, AreaSummary } from "./types";

export const repositoryRoot = process.env.REPOSITORY_ROOT || path.resolve(process.cwd(), "..");
const contentRoot = path.join(repositoryRoot, "content");

export const getAreaSummaries = cache(async (): Promise<AreaSummary[]> => {
  return JSON.parse(await readFile(path.join(contentRoot, "areas.json"), "utf8"));
});

export const getArea = cache(async (slug: string): Promise<Area | null> => {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return JSON.parse(await readFile(path.join(contentRoot, "areas", `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
});
