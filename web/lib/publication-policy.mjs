const protectedTerms = /\b(?:access|tillträde|parkering|parkeringsplats|p-plats|vägbeskrivning|klätterstopp|stängd|stängt|stängda|förbud|säkerhet|farlig|farligt|rasrisk|löst\s+block|lösa\s+block|häckning|fågelskydd|markägare|räddning)\b/i;

export function patchNeedsHumanReview(patch) {
  if (patch.field === "access" || patch.field === "coordinates") return true;
  return protectedTerms.test(`${patch.value || ""} ${patch.rationale || ""}`);
}
