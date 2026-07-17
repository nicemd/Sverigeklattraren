export type SourceReference = {
  id: string;
  title: string;
  path?: string;
  url?: string;
  license?: string;
  snapshotDate?: string;
  importedAt?: string;
  sourceModifiedAt?: string;
  usage?: "licensed-content" | "fact-reference" | "firsthand";
  rightsNote?: string;
};

export type Route = {
  id: string;
  kind: "route" | "problem";
  number: string | null;
  name: string;
  grade: string;
  length: string;
  type: string;
  firstAscent: string;
  description: string;
  sectorId: string | null;
  source: { id: string; path?: string; url?: string };
  fieldSources?: Partial<Record<"name" | "grade" | "number" | "length" | "type" | "firstAscent" | "description" | "sectorId", string[]>>;
};

export type AreaSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  coordinates: { latitude: number | null; longitude: number | null } | null;
  categories: string[];
  routeCount: number;
  imageCount: number;
  accessSlug: string | null;
  searchText: string;
};

export type Area = Omit<AreaSummary, "routeCount" | "imageCount" | "accessSlug" | "searchText"> & {
  schemaVersion: number;
  sections: Array<{ id: string; title: string; body: string; sourceStart?: number; sourceEnd?: number }>;
  routes: Route[];
  images: Array<{ filename: string; caption: string; missing?: boolean; sectorId?: string | null; routeIds?: string[] }>;
  externalLinks?: Array<{ url: string; label: string; sectionId?: string | null }>;
  access: { legacyText: string | null; federationSlug: string | null };
  qualityIssues: Array<{ code: string; message: string }>;
  provenance: { primarySourceId: string; sources: SourceReference[] };
};
