"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Area, AreaSummary } from "@/lib/types";

type ConversationEntry = { role: "user" | "assistant"; content: string };
type AccessInfo = { title: string; status: string; summary: string; url: string; sourceUpdatedAt: string | null; fetchedAt: string };

const formatDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "long" }).format(new Date(value))
  : "datum saknas";

function RichText({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/[^\s)]+)/g);
  return <>{pieces.map((piece, index) => /^https?:\/\//.test(piece)
    ? <a className="inline-link" href={piece} target="_blank" rel="noreferrer" key={`${piece}-${index}`}>{piece}</a>
    : <Fragment key={index}>{piece}</Fragment>)}</>;
}

function StructuredProse({ blocks, fallback }: { blocks?: Area["sections"][number]["blocks"]; fallback: string }) {
  if (!blocks?.length) return <p><RichText text={fallback} /></p>;
  return <div className="structured-prose">{blocks.map((block, index) => block.kind === "heading"
    ? <strong className="prose-heading" key={`${block.text}-${index}`}>{block.text}</strong>
    : block.kind === "list"
      ? <ul key={`list-${index}`}>{block.items.map((item) => <li key={item}><RichText text={item} /></li>)}</ul>
      : <p key={`${block.text}-${index}`}><RichText text={block.text} /></p>)}</div>;
}

function routeImageRelation(image: Area["images"][number], routeId: string) {
  return image.routeRelations?.find((relation) => relation.routeId === routeId)
    || (image.routeIds?.includes(routeId) ? { routeId, method: "source-order" as const, confidence: 0.72, evidence: "Leden följer bilden i samma originalsektion." } : null);
}

function areaMatches(area: AreaSummary, query: string, filter: string) {
  const haystack = `${area.name} ${area.description} ${area.categories.join(" ")} ${area.searchText}`.toLocaleLowerCase("sv");
  const matchesQuery = haystack.includes(query.toLocaleLowerCase("sv").trim());
  const matchesFilter = filter === "Alla"
    || (filter === "Klippa" && !area.categories.some((category) => /boulder/i.test(category)))
    || (filter === "Boulder" && area.categories.some((category) => /boulder/i.test(category)))
    || (filter === "Access" && Boolean(area.accessSlug));
  return matchesQuery && matchesFilter;
}

export function GuideApp({ areas, initialArea }: { areas: AreaSummary[]; initialArea: Area | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Alla");
  const [selected, setSelected] = useState<Area | null>(initialArea);
  const [loading, setLoading] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [accessResult, setAccessResult] = useState<{ slug: string; info: AccessInfo | null } | null>(null);
  const selectedAccessSlug = selected?.access.federationSlug || null;
  const access = accessResult?.slug === selectedAccessSlug ? accessResult.info : null;

  const filtered = useMemo(() => areas.filter((area) => areaMatches(area, query, filter)), [areas, filter, query]);
  const displayedAreas = useMemo(() => {
    if (!selected || query.trim() || !filtered.some((area) => area.slug === selected.slug)) return filtered;
    return [filtered.find((area) => area.slug === selected.slug)!, ...filtered.filter((area) => area.slug !== selected.slug)];
  }, [filtered, query, selected]);

  async function selectArea(slug: string) {
    setLoading(true);
    const response = await fetch(`/api/areas/${slug}`);
    if (response.ok) setSelected(await response.json());
    setLoading(false);
  }

  useEffect(() => {
    const slug = selected?.access.federationSlug;
    if (!slug) return;
    fetch(`/api/access/${encodeURIComponent(slug)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((info) => setAccessResult({ slug, info }))
      .catch(() => setAccessResult({ slug, info: null }));
  }, [selected?.access.federationSlug]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand" aria-label="Sverigeföraren">
          <div className="brand-mark">SF</div>
          <div><strong>Sverigeföraren</strong><small>Öppen klätterkunskap</small></div>
        </div>
        <label className="search-wrap">
          <span className="sr-only">Sök område eller led</span>
          <input className="search" value={query} onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            const matches = areas.filter((area) => areaMatches(area, value, filter));
            if (value.trim() && matches.length === 1 && matches[0].slug !== selected?.slug) void selectArea(matches[0].slug);
          }} placeholder="Sök område, led eller grad…" />
        </label>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => setShowAbout(true)}>Om projektet</button>
          <button className="primary-button" type="button" onClick={() => setShowSuggestion(true)}>Föreslå ändring</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="area-nav">
          <div className="nav-kicker">{filtered.length} av {areas.length} områden</div>
          <div className="filter-row" aria-label="Filtrera områden">
            {["Alla", "Klippa", "Boulder", "Access"].map((option) => (
              <button key={option} className={`filter-chip ${filter === option ? "active" : ""}`} type="button" onClick={() => setFilter(option)}>{option}</button>
            ))}
          </div>
          <div className="area-list">
            {displayedAreas.map((area) => (
              <button className={`area-item ${selected?.slug === area.slug ? "active" : ""}`} type="button" key={area.id} onClick={() => selectArea(area.slug)}>
                <strong>{area.name}</strong><span className="count-pill">{area.routeCount}</span>
                <span className="area-meta">{area.categories.slice(0, 2).join(" · ") || "Sverige"}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="main-canvas" aria-busy={loading}>
          {selected ? <AreaView key={selected.slug} area={selected} access={access} globalQuery={query} onSuggest={() => setShowSuggestion(true)} /> : <div className="empty">Inget område valt.</div>}
        </main>
      </div>
      {showSuggestion && selected && <SuggestionDialog area={selected} onClose={() => setShowSuggestion(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="modal-head"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>Om projektet</span><h2 id="about-title">Öppen klätterkunskap, byggd för att leva vidare</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Stäng">×</button></div>
        <p>Sverigeföraren utgår från den öppet licensierade wikin som bevarades 2014. Originaltext och bilder ligger kvar som primärkällor, medan den moderna sajten strukturerar materialet för sökning, karta och tydlig källspårning.</p>
        <p>Förslag granskas av tre separata AI-roller: en som samlar fakta, en som formulerar ändringen och en oberoende kvalitetsgranskare. Säkerhets- och accessinformation publiceras aldrig automatiskt.</p>
        <p><strong>Licens:</strong> GNU Free Documentation License. Nya externa källor behåller sin egen attribution och licensmetadata.</p>
        <a className="source-link" href="https://github.com/nicemd/Sverigeforaren" target="_blank" rel="noreferrer"><span>Projektets Git-repository</span><span>↗</span></a>
      </section>
    </div>
  );
}

function AreaMap({ area }: { area: Area }) {
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mapRef.current || !area.coordinates?.latitude || !area.coordinates.longitude) return;
    let map: import("maplibre-gl").Map | undefined;
    let cancelled = false;
    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (cancelled || !mapRef.current) return;
      map = new maplibregl.Map({
        container: mapRef.current,
        style: "https://tiles.openfreemap.org/styles/bright",
        center: [area.coordinates!.longitude!, area.coordinates!.latitude!],
        zoom: 10.5,
        attributionControl: false,
      });
      new maplibregl.Marker({ color: "#ed7447" })
        .setLngLat([area.coordinates!.longitude!, area.coordinates!.latitude!])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText(area.name))
        .addTo(map);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    });
    return () => { cancelled = true; map?.remove(); };
  }, [area]);
  return <div id="area-map" ref={mapRef} aria-label={`Karta över ${area.name}`} />;
}

function AreaView({ area, access, globalQuery, onSuggest }: { area: Area; access: AccessInfo | null; globalQuery: string; onSuggest: () => void }) {
  const routeCount = area.routes.length;
  const [routeQuery, setRouteQuery] = useState("");
  const [discipline, setDiscipline] = useState<"all" | "route" | "problem">("all");
  const [sectorId, setSectorId] = useState("all");
  const [openImage, setOpenImage] = useState<Area["images"][number] | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showBeta, setShowBeta] = useState(false);
  const normalizedGlobalQuery = globalQuery.trim().toLocaleLowerCase("sv");
  const globalRouteQuery = normalizedGlobalQuery
    && normalizedGlobalQuery !== area.name.toLocaleLowerCase("sv")
    && area.routes.some((route) => `${route.name} ${route.grade}`.toLocaleLowerCase("sv").includes(normalizedGlobalQuery)) ? globalQuery.trim() : "";
  const effectiveRouteQuery = routeQuery || globalRouteQuery;
  const normalizedRouteQuery = effectiveRouteQuery.toLocaleLowerCase("sv").trim();
  const sectionById = useMemo(() => new Map(area.sections.map((section) => [section.id, section])), [area.sections]);
  const sectors = useMemo(() => {
    const counts = new Map<string, { id: string; title: string; count: number }>();
    area.routes.forEach((route) => {
      if (discipline !== "all" && route.kind !== discipline) return;
      if (!route.sectorId) return;
      const current = counts.get(route.sectorId);
      counts.set(route.sectorId, { id: route.sectorId, title: sectionById.get(route.sectorId)?.title || "Övriga leder", count: (current?.count || 0) + 1 });
    });
    return [...counts.values()];
  }, [area.routes, discipline, sectionById]);
  const visibleRoutes = area.routes.filter((route) => {
    const matchesDiscipline = discipline === "all" || route.kind === discipline;
    const matchesSector = sectorId === "all" || route.sectorId === sectorId;
    const haystack = `${route.name} ${route.grade} ${route.type} ${route.description}`.toLocaleLowerCase("sv");
    return matchesDiscipline && matchesSector && (!normalizedRouteQuery || haystack.includes(normalizedRouteQuery));
  });
  const exactRoute = visibleRoutes.length === 1 ? visibleRoutes[0] : null;
  const exactSector = exactRoute?.sectorId ? area.sections.find((section) => section.id === exactRoute.sectorId) : null;
  const sectorRoutes = exactRoute?.sectorId ? area.routes.filter((route) => route.sectorId === exactRoute.sectorId && route.kind === exactRoute.kind) : [];
  const exactIndex = exactRoute ? sectorRoutes.findIndex((route) => route.id === exactRoute.id) : -1;
  const exactSourceIds = exactRoute ? [...new Set([exactRoute.source.id, ...Object.values(exactRoute.fieldSources || {}).flat()])] : [];
  const disciplineSectorIds = new Set(area.routes.filter((route) => discipline === "all" || route.kind === discipline).map((route) => route.sectorId).filter(Boolean));
  const preferredImageSector = sectorId !== "all" ? sectorId : exactRoute?.sectorId;
  const visibleImages = area.images
    .filter((image) => !image.missing
      && (discipline === "all" || !image.sectorId || disciplineSectorIds.has(image.sectorId))
      && (sectorId === "all" || !image.sectorId || image.sectorId === sectorId))
    .sort((left, right) => Number(right.sectorId === preferredImageSector) - Number(left.sectorId === preferredImageSector));
  const directions = area.sections.find((section) => /vägbeskrivning|hitta hit|anmarsch/i.test(section.title));
  const routeTotal = area.routes.filter((route) => route.kind === "route").length;
  const problemTotal = area.routes.filter((route) => route.kind === "problem").length;
  const disciplineTotal = discipline === "route" ? routeTotal : discipline === "problem" ? problemTotal : routeCount;
  const selectedRoute = selectedRouteId ? area.routes.find((route) => route.id === selectedRouteId) || null : null;
  const selectedRouteSector = selectedRoute?.sectorId ? sectionById.get(selectedRoute.sectorId) : null;
  const selectedRouteSources = selectedRoute ? [...new Set([selectedRoute.source.id, ...Object.values(selectedRoute.fieldSources || {}).flat()])] : [];
  const selectedRouteImageKey = selectedRoute?.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sv").replace(/[^a-z0-9]+/g, "") || "";
  const selectedRouteImageCandidates = selectedRoute ? area.images
    .filter((image) => !image.missing && image.imageKind !== "photo" && image.imageKind !== "map" && (routeImageRelation(image, selectedRoute.id)?.confidence || 0) >= 0.7)
    : [];
  const hasVerifiedRouteImage = selectedRouteImageCandidates.some((image) => selectedRoute && (routeImageRelation(image, selectedRoute.id)?.confidence || 0) >= 0.85);
  const selectedRouteImages = selectedRouteImageCandidates
    .filter((image) => !hasVerifiedRouteImage || (selectedRoute && (routeImageRelation(image, selectedRoute.id)?.confidence || 0) >= 0.85))
    .sort((left, right) => {
      const score = (image: Area["images"][number]) => Number(image.routeIds?.includes(selectedRoute!.id)) * 2 + Number(image.filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sv").replace(/[^a-z0-9]+/g, "").includes(selectedRouteImageKey));
      return score(right) - score(left);
    });
  const openImageRoute = selectedRoute && openImage?.routeIds?.includes(selectedRoute.id) ? selectedRoute : null;
  const openImageRouteColor = openImageRoute?.description.match(/^\(([^)]+)\)/)?.[1] || null;
  const climbingLabel = routeTotal > 0 && problemTotal > 0 ? "Repklättring · Bouldering" : problemTotal > 0 ? "Bouldering" : routeTotal > 0 ? "Repklättring" : "Svenskt klätterområde";
  const countLabel = routeTotal > 0 && problemTotal > 0 ? "leder & problem" : problemTotal > 0 ? "problem" : "leder";
  const routeSectorIds = new Set(area.routes.map((route) => route.sectorId).filter(Boolean));
  const looseSections = area.sections.filter((section) => section.body
    && !routeSectorIds.has(section.id)
    && section.id !== directions?.id
    && !/^(allmänt|access)$/i.test(section.title)
    && section.body !== area.description);

  return (
    <>
      <section className="hero-grid">
        <article className="area-hero">
          <span className="eyebrow">{climbingLabel}</span>
          <h1>{area.name}</h1>
          <p><RichText text={area.description} /></p>
          <div className="hero-stats">
            <div className="hero-stat"><strong>{routeCount}</strong><span>{countLabel}</span></div>
            <div className="hero-stat"><strong>{area.images.length}</strong><span>bilder & topos</span></div>
            <div className="hero-stat"><strong>{new Set(area.routes.map((route) => route.grade).filter(Boolean)).size}</strong><span>grader</span></div>
          </div>
        </article>
        <div className="map-card">
          {area.coordinates?.latitude && area.coordinates.longitude ? <AreaMap area={area} /> : <div className="empty">Koordinater saknas i originalkällan.</div>}
          <div className="map-overlay"><strong>{area.name}</strong><span>{area.coordinates?.latitude?.toFixed(4) || "–"}, {area.coordinates?.longitude?.toFixed(4) || "–"}</span></div>
        </div>
      </section>

      <section className="arrival-card" aria-labelledby="arrival-title">
        <div><span className="eyebrow" style={{ color: "var(--forest)" }}>På väg till berget</span><h2 id="arrival-title">Hitta klippan</h2></div>
        <StructuredProse blocks={directions?.blocks} fallback={directions?.body || "Originalkällan saknar en strukturerad vägbeskrivning. Använd kartpunkten med försiktighet och föreslå gärna en verifierad anmarsch."} />
        {area.coordinates?.latitude && area.coordinates.longitude && <a className="primary-button directions-button" href={`https://www.google.com/maps/dir/?api=1&destination=${area.coordinates.latitude},${area.coordinates.longitude}`} target="_blank" rel="noreferrer">Vägbeskrivning ↗</a>}
        <small>Vägbeskrivningen är från 2014. Kontrollera alltid aktuell access före avfärd.</small>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>På klippan</span><h2>{routeCount ? "Hitta leden" : "Originalförarens anteckningar"}</h2></div><span>Från Sverigeföraren 2014</span></div>
          {routeCount > 0 && <div className="route-finder">
            {routeTotal > 0 && problemTotal > 0 && <div className="discipline-tabs" aria-label="Välj klätterform">
              <button type="button" className={discipline === "all" ? "active" : ""} onClick={() => { setDiscipline("all"); setSectorId("all"); }}>Allt <small>{routeCount}</small></button>
              <button type="button" className={discipline === "route" ? "active" : ""} onClick={() => { setDiscipline("route"); setSectorId("all"); }}>Repklättring <small>{routeTotal}</small></button>
              <button type="button" className={discipline === "problem" ? "active" : ""} onClick={() => { setDiscipline("problem"); setSectorId("all"); }}>Bouldering <small>{problemTotal}</small></button>
            </div>}
            <label>
              <span className="sr-only">Sök led i {area.name}</span>
              <input value={effectiveRouteQuery} onChange={(event) => setRouteQuery(event.target.value)} placeholder={`Sök bland ${routeCount} ${countLabel}…`} />
            </label>
            <div className="sector-tabs" aria-label="Välj sektor">
              <button type="button" className={sectorId === "all" ? "active" : ""} onClick={() => setSectorId("all")}>Alla sektorer <small>{disciplineTotal}</small></button>
              {sectors.map((sector) => <button type="button" key={sector.id} className={sectorId === sector.id ? "active" : ""} onClick={() => setSectorId(sector.id)}>{sector.title} <small>{sector.count}</small></button>)}
            </div>
          </div>}
          {exactRoute && (
            <div className="field-result" role="status">
              <span className="field-result-kicker">{exactSector ? `Sektor ${exactSector.title}` : "Sektor saknas i källan"}</span>
              <strong>{exactRoute.name} · {exactRoute.grade || "ograderad"}</strong>
              {exactSector?.body && <p><RichText text={exactSector.body} /></p>}
              {exactIndex >= 0 && <div className="route-neighbours"><span>Vänster: <b>{sectorRoutes[exactIndex - 1]?.name || "sektorgräns"}</b></span><span>Position <b>{exactIndex + 1} av {sectorRoutes.length}</b> i sektorn</span><span>Höger: <b>{sectorRoutes[exactIndex + 1]?.name || "sektorgräns"}</b></span></div>}
              <div className="route-citations"><span>Källor för leden</span>{exactSourceIds.map((sourceId) => {
                const source = area.provenance.sources.find((item) => item.id === sourceId);
                if (!source) return null;
                const fields = Object.entries(exactRoute.fieldSources || {}).filter(([, ids]) => ids?.includes(sourceId)).map(([field]) => field);
                const href = source.url || `/api/source/${area.slug}`;
                return <a key={sourceId} href={href} target="_blank" rel="noreferrer">{source.title}{fields.length ? ` · ${fields.join(", ")}` : " · importerad led"} ↗</a>;
              })}</div>
            </div>
          )}
          {looseSections.length > 0 && <section className="legacy-notes" aria-label="Anteckningar från originalföraren">
            <div className="legacy-notes-heading"><strong>Anteckningar från originalföraren</strong><span>Historiskt, löst strukturerat material</span></div>
            {looseSections.map((section) => <article key={section.id}><h3>{section.title}</h3><p><RichText text={section.body} /></p></article>)}
          </section>}
          {visibleImages.length > 0 && (
            <div className="image-strip" aria-label={`Bilder från ${area.name}`}>
              {visibleImages.slice(0, 3).map((image) => (
                <button type="button" key={image.filename} onClick={() => setOpenImage(image)} title="Visa skiss eller bild i full storlek" aria-label={`Visa bild: ${image.caption}`}>
                  <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${encodeURIComponent(image.filename)}`} alt={image.caption || `Klättring vid ${area.name}`} loading="lazy" />
                  <figcaption>{image.sectorId && sectionById.get(image.sectorId) ? `${sectionById.get(image.sectorId)!.title} · ` : ""}{image.caption || "Visa skiss"}</figcaption>
                  </figure>
                </button>
              ))}
            </div>
          )}
          <div className="route-list">
            {visibleRoutes.map((route, visibleIndex) => (
              <Fragment key={route.id}>
              {(visibleIndex === 0 || visibleRoutes[visibleIndex - 1]?.sectorId !== route.sectorId) && <div className="sector-heading"><strong>{route.sectorId ? sectionById.get(route.sectorId)?.title || "Övriga leder" : "Övriga leder"}</strong><span><RichText text={route.sectorId ? sectionById.get(route.sectorId)?.body || "Sektorsbeskrivning saknas i originalet." : "Sektorsbeskrivning saknas i originalet."} /></span></div>}
              <button type="button" className={`route-row ${exactRoute?.id === route.id ? "highlighted" : ""}`} onClick={() => { setSelectedRouteId(route.id); setShowBeta(false); }} aria-label={`Öppna fältkort för ${route.name}`}>
                <span className="route-number" title={route.number ? "Nummer i originalets skiss/lista" : "Lednummer saknas i originalkällan"}>{route.number || "–"}</span>
                <span className="route-name"><strong>{route.name}</strong><small>Visa fältkort{area.images.some((image) => image.imageKind !== "photo" && image.imageKind !== "map" && (routeImageRelation(image, route.id)?.confidence || 0) >= 0.7) ? " · skiss finns" : ""}</small></span>
                <span className="grade">{route.grade || "–"}</span>
                <span className="route-length">{route.length ? `${route.length} m` : route.type}</span>
              </button>
              </Fragment>
            ))}
            {!area.routes.length && <div className="empty">Originalet innehåller inga ledposter som säkert kan struktureras. Anteckningar och externa länkar visas ändå ovan.</div>}
            {area.routes.length > 0 && !visibleRoutes.length && <div className="empty">Ingen led matchar sökningen i vald sektor.</div>}
          </div>
          {area.routes.length > 0 && <div className="list-note">Visar {visibleRoutes.length} av {area.routes.length}. Ledordning och sektortext kommer från originalkällan.</div>}
        </article>

        <aside>
          <article className="panel access-card">
            <span className="eyebrow" style={{ color: "#8c5c13" }}>Aktuell access</span>
            <div className="status-line"><span className="status-dot" /><strong>{access?.status || (area.access.federationSlug ? "Hämtar från Klätterförbundet…" : "Ingen direktkoppling ännu")}</strong></div>
            <p>{access?.summary || area.access.legacyText || "Det saknas kopplad accessinformation för området. Kontrollera alltid lokala regler före besöket."}</p>
            {access && <a className="source-link" href={access.url} target="_blank" rel="noreferrer"><span>Klätterförbundets accessdatabas<br /><small>Uppdaterad {formatDate(access.sourceUpdatedAt)} · hämtad {formatDate(access.fetchedAt)}</small></span><span>↗</span></a>}
          </article>
          <article className="panel source-card">
            <span className="eyebrow" style={{ color: "var(--forest)" }}>Källspårning</span>
            <h2>{area.provenance.sources.length} {area.provenance.sources.length === 1 ? "källa" : "källor"}</h2>
            <p>Legacyuppgifter pekar på originalfilen. Externa fakta spåras per fält på berörd led; en faktareferens ger aldrig rätt att kopiera beskrivning, bild eller topo.</p>
            {area.provenance.sources.map((source) => <a className="source-link" key={source.id} href={source.url || `/api/source/${area.slug}`} target="_blank" rel="noreferrer"><span>{source.title}<br /><small>{source.usage === "fact-reference" ? "Faktareferens · inget material återpublicerat" : `${source.license || "Källmaterial"} · ${source.snapshotDate ? `ögonblicksbild ${source.snapshotDate.slice(0, 4)}` : "spårad källa"}`}</small></span><span>↗</span></a>)}
            {area.externalLinks?.map((link) => <a className="source-link external" key={link.url} href={link.url} target="_blank" rel="noreferrer"><span>{link.label || "Extern länk"}<br /><small>Extern länk från originalföraren · materialet återpubliceras inte</small></span><span>↗</span></a>)}
            <button className="primary-button" style={{ width: "100%", marginTop: 18 }} type="button" onClick={onSuggest}>Föreslå förbättring</button>
          </article>
        </aside>
      </section>
      {openImage && <div className="image-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenImage(null); }}>
        <section role="dialog" aria-modal="true" aria-label={`Skiss eller bild från ${area.name}`}>
          <div className="image-modal-head"><div><span className="eyebrow">{openImage.sectorId ? sectionById.get(openImage.sectorId)?.title || area.name : area.name}</span><strong>{openImage.caption || "Skiss från originalföraren"}</strong></div><button type="button" onClick={() => setOpenImage(null)} aria-label="Stäng skiss">×</button></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/media/${encodeURIComponent(openImage.filename)}`} alt={openImage.caption || `Skiss eller bild från ${area.name}`} />
          {openImageRoute && <div className="image-route-context"><strong>{openImageRoute.number || "Utan nummer"} · {openImageRoute.name}</strong><span>{openImageRoute.grade || "Ograderad"}{openImageRouteColor ? ` · ${openImageRouteColor.toLocaleLowerCase("sv")} i originaltopon` : ""}</span></div>}
          <p>Lednumren i listan motsvarar originalskissen när ett nummer finns angivet i källan.</p>
        </section>
      </div>}
      {selectedRoute && <div className="route-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRouteId(null); }}>
        <section className="route-detail" role="dialog" aria-modal="true" aria-label={`Fältkort för ${selectedRoute.name}`}>
          <div className="route-detail-head">
            <div><span className="eyebrow">{selectedRouteSector?.title || "Sektor saknas"} · {selectedRoute.number || "utan nummer"}</span><h2>{selectedRoute.name}</h2></div>
            <button type="button" onClick={() => setSelectedRouteId(null)} aria-label="Stäng fältkort">×</button>
          </div>
          <div className="route-detail-facts"><strong>{selectedRoute.grade || "Ograderad"}</strong><span>{selectedRoute.kind === "problem" ? "Boulderproblem" : "Klätterled"}</span>{selectedRoute.length && <span>{selectedRoute.length} m</span>}{selectedRoute.type && <span>{selectedRoute.type}</span>}</div>
          {selectedRoute.firstAscent && <p className="first-ascent">Förstebestigning: <strong>{selectedRoute.firstAscent}</strong></p>}
          {selectedRoute.extraction?.method === "llm" && <p className="extraction-note">Strukturerad med OpenAI från originalförarens löptext · konfidens {Math.round(selectedRoute.extraction.confidence * 100)} %</p>}
          {selectedRoute.description ? <div className="beta-panel">
            {!showBeta ? <button type="button" className="beta-toggle" onClick={() => setShowBeta(true)}>Visa beta</button> : <><div className="beta-heading"><strong>Beta från originalföraren</strong><button type="button" onClick={() => setShowBeta(false)}>Dölj beta</button></div><p><RichText text={selectedRoute.description} /></p></>}
          </div> : <p className="no-beta">Originalföraren innehåller ingen beta för {selectedRoute.kind === "problem" ? "problemet" : "leden"}.</p>}
          {selectedRouteImages.length > 0 ? <div className="route-detail-images"><div><strong>Kopplad skiss</strong><span>{selectedRouteImages.some((image) => routeImageRelation(image, selectedRoute.id)?.method === "vision" && (routeImageRelation(image, selectedRoute.id)?.confidence || 0) >= 0.85) ? "Lednumret är avläst i originalskissen" : "Kopplad genom bildens placering vid ledlistan i originalet"} · tryck för full storlek</span></div><div>{selectedRouteImages.slice(0, 4).map((image) => <button type="button" key={image.filename} onClick={() => setOpenImage(image)} aria-label={`Visa bild: ${image.caption}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${encodeURIComponent(image.filename)}`} alt={image.caption} /><span>{image.caption}</span>
          </button>)}</div></div> : <p className="no-topo">Ingen skiss har ännu kunnat kopplas säkert till den här leden.</p>}
          <div className="route-detail-sources"><strong>Källor för uppgifterna</strong>{selectedRouteSources.map((sourceId) => { const source = area.provenance.sources.find((item) => item.id === sourceId); return source ? <a key={sourceId} href={source.url || `/api/source/${area.slug}`} target="_blank" rel="noreferrer">{source.title} ↗</a> : null; })}</div>
        </section>
      </div>}
    </>
  );
}

function SuggestionDialog({ area, onClose }: { area: Area; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || pending) return;
    const next = [...conversation, { role: "user" as const, content: message.trim() }];
    setConversation(next);
    setMessage("");
    setPending(true);
    try {
      const response = await fetch("/api/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ areaSlug: area.slug, conversation: next }) });
      const result = await response.json();
      setConversation([...next, { role: "assistant", content: result.reply || result.error || "Förslaget kunde inte behandlas." }]);
    } catch {
      setConversation([...next, { role: "assistant", content: "Tjänsten kunde inte nås. Försök igen om en stund." }]);
    } finally { setPending(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="suggest-title">
        <div className="modal-head"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>Kunskapsbidrag</span><h2 id="suggest-title">Förbättra {area.name}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Stäng">×</button></div>
        <p>Beskriv vad som är fel eller saknas. Redaktörsagenten ställer följdfrågor tills uppgiften går att källbelägga och granska.</p>
        <div className="conversation">{conversation.map((entry, index) => <div key={index} className={`bubble ${entry.role}`}>{entry.content}</div>)}</div>
        <form className="suggestion-form" onSubmit={submit}>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Exempel: Parkeringen har flyttats till… Källa: …" aria-label="Ditt ändringsförslag" />
          <div className="form-actions"><small>Fakta publiceras bara när källor och kvalitet klarar granskningsgrinden.</small><button className="primary-button" disabled={pending} type="submit">{pending ? "Granskar…" : "Fortsätt"}</button></div>
        </form>
      </section>
    </div>
  );
}
