import { createHash } from "node:crypto";

export function translationContext(area) {
  return {
    name: area.name,
    description: area.description,
    categories: area.categories,
    sections: area.sections.map(({ id, title, body }) => ({ id, title, body })),
    routes: area.routes.map(({ id, kind, number, name, grade, type, sectorId, description, beta }) => ({ id, kind, number, name, grade, type, sectorId, description, beta: beta || "" })),
  };
}

export function translationContextHash(area) {
  return createHash("sha256").update(JSON.stringify(translationContext(area))).digest("hex");
}

export function translationPunctuationHash(area) {
  const translatableTextFields = new Set(["description", "body", "beta"]);
  const normalized = JSON.stringify(translationContext(area), (key, value) =>
    typeof value === "string" && translatableTextFields.has(key) ? value.trimEnd().replace(/\.$/u, "") : value
  );
  return createHash("sha256").update(normalized).digest("hex");
}
