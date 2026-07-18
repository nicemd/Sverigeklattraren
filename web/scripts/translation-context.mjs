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
