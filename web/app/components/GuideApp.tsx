"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Area, AreaSummary } from "@/lib/types";

type ConversationEntry = { role: "user" | "assistant"; content: string };
type AccessInfo = { title: string; status: string; summary: string; url: string; sourceUpdatedAt: string | null; fetchedAt: string };

const formatDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "long" }).format(new Date(value))
  : "datum saknas";

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

  const filtered = useMemo(() => areas.filter((area) => {
    const haystack = `${area.name} ${area.description} ${area.categories.join(" ")} ${area.searchText}`.toLocaleLowerCase("sv");
    const matchesQuery = haystack.includes(query.toLocaleLowerCase("sv").trim());
    const matchesFilter = filter === "Alla"
      || (filter === "Klippa" && !area.categories.some((category) => /boulder/i.test(category)))
      || (filter === "Boulder" && area.categories.some((category) => /boulder/i.test(category)))
      || (filter === "Access" && Boolean(area.accessSlug));
    return matchesQuery && matchesFilter;
  }), [areas, filter, query]);
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
          <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök område, led eller grad…" />
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
          {selected ? <AreaView area={selected} access={access} onSuggest={() => setShowSuggestion(true)} /> : <div className="empty">Inget område valt.</div>}
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
    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!mapRef.current) return;
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
    return () => map?.remove();
  }, [area]);
  return <div id="area-map" ref={mapRef} aria-label={`Karta över ${area.name}`} />;
}

function AreaView({ area, access, onSuggest }: { area: Area; access: AccessInfo | null; onSuggest: () => void }) {
  const routeCount = area.routes.length;
  return (
    <>
      <section className="hero-grid">
        <article className="area-hero">
          <span className="eyebrow">{area.categories.slice(0, 2).join(" · ") || "Svenskt klätterområde"}</span>
          <h1>{area.name}</h1>
          <p>{area.description}</p>
          <div className="hero-stats">
            <div className="hero-stat"><strong>{routeCount}</strong><span>leder & problem</span></div>
            <div className="hero-stat"><strong>{area.images.length}</strong><span>bilder & topos</span></div>
            <div className="hero-stat"><strong>{new Set(area.routes.map((route) => route.grade).filter(Boolean)).size}</strong><span>grader</span></div>
          </div>
        </article>
        <div className="map-card">
          {area.coordinates?.latitude && area.coordinates.longitude ? <AreaMap area={area} /> : <div className="empty">Koordinater saknas i originalkällan.</div>}
          <div className="map-overlay"><strong>{area.name}</strong><span>{area.coordinates?.latitude?.toFixed(4) || "–"}, {area.coordinates?.longitude?.toFixed(4) || "–"}</span></div>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading"><h2>Leder & problem</h2><span>Från Sverigeföraren 2014</span></div>
          {area.images.some((image) => !image.missing) && (
            <div className="image-strip" aria-label={`Bilder från ${area.name}`}>
              {area.images.filter((image) => !image.missing).slice(0, 3).map((image) => (
                <figure key={image.filename}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${encodeURIComponent(image.filename)}`} alt={image.caption || `Klättring vid ${area.name}`} loading="lazy" />
                  {image.caption && <figcaption>{image.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          <div className="route-list">
            {area.routes.slice(0, 80).map((route, index) => (
              <div className="route-row" key={route.id}>
                <span className="route-number">{route.number || index + 1}</span>
                <div className="route-name"><strong>{route.name}</strong>{route.description && <small>{route.description}</small>}</div>
                <span className="grade">{route.grade || "–"}</span>
                <span className="route-length">{route.length ? `${route.length} m` : route.type}</span>
              </div>
            ))}
            {!area.routes.length && <div className="empty">Inga strukturerade leder hittades i originalet.</div>}
          </div>
          {area.routes.length > 80 && <div className="list-note">Visar de första 80 av {area.routes.length} posterna i denna första vy.</div>}
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
            <h2>{area.provenance.sources.length} primärkälla</h2>
            <p>Varje importerad uppgift är kopplad till originalfilen. Nya uppgifter kräver uttrycklig källa och granskningsresultat.</p>
            <a className="source-link" href={`/api/source/${area.slug}`} target="_blank"><span>{area.provenance.sources[0]?.title}<br /><small>GNU FDL · ögonblicksbild 2014</small></span><span>↗</span></a>
            <button className="primary-button" style={{ width: "100%", marginTop: 18 }} type="button" onClick={onSuggest}>Föreslå förbättring</button>
          </article>
        </aside>
      </section>
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
