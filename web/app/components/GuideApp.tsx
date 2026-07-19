"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Area, AreaSummary } from "@/lib/types";

type ConversationEntry = { role: "user" | "assistant"; content: string };
type AccessInfo = { title: string; status: string; summary: string; url: string; sourceUpdatedAt: string | null; fetchedAt: string };
type Locale = "sv" | "en";
type GuideOverlayState = { areaSlug: string; routeId?: string; imageFilename?: string };

const overlayHistoryKey = "sverigeklattrarenOverlay";

const tr = (locale: Locale, swedish: string, english: string) => locale === "en" ? english : swedish;
const formatDate = (value: string | null | undefined, locale: Locale) => value
  ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", { dateStyle: "long" }).format(new Date(value))
  : tr(locale, "datum saknas", "date unavailable");
const localized = (area: Area, locale: Locale, field: "name" | "description") => locale === "en" ? area.translations?.en?.[field]?.text || area[field] : area[field];

function RichText({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/[^\s)]+)/g);
  return <>{pieces.map((piece, index) => /^https?:\/\//.test(piece)
    ? <a className="inline-link" href={piece} target="_blank" rel="noreferrer" key={`${piece}-${index}`}>{piece}</a>
    : <Fragment key={index}>{piece}</Fragment>)}</>;
}

function MachineTranslationNote({ value, original, compact = false }: { value?: { method: "human" | "llm"; model?: string }; original: string; compact?: boolean }) {
  if (value?.method !== "llm") return null;
  const model = value.model ? ` with ${value.model}` : "";
  return <details className={`machine-translation ${compact ? "compact" : ""}`}>
    <summary>Machine translated from Swedish{model} · View original</summary>
    <p lang="sv"><RichText text={original} /></p>
  </details>;
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

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("sv").replace(/[^a-z0-9åäö]+/g, " ").trim();
}

function uniqueImages(images: Area["images"]) {
  return [...new Map(images.map((image) => [image.filename.toLocaleLowerCase("sv"), image])).values()];
}

function areaMatches(area: AreaSummary, query: string, filter: string) {
  const english = area.translations?.en;
  const translatedSearchText = [english?.name?.text, english?.description?.text,
    ...Object.values(english?.sections || {}).flatMap((section) => [section.title?.text, section.body?.text]),
    ...Object.values(english?.routes || {}).flatMap((route) => [route.name?.text, route.description?.text])].filter(Boolean).join(" ");
  const haystack = normalizeSearch(`${area.name} ${area.description} ${area.categories.join(" ")} ${area.searchText} ${translatedSearchText}`);
  const matchesQuery = haystack.includes(normalizeSearch(query));
  const matchesFilter = filter === "Alla"
    || (filter === "Klippa" && !area.categories.some((category) => /boulder/i.test(category)))
    || (filter === "Boulder" && area.categories.some((category) => /boulder/i.test(category)))
    || (filter === "Sport" && /\bsport/i.test(haystack))
    || (filter === "Trad" && /\btrad/i.test(haystack))
    || (filter === "Is" && area.categories.some((category) => /(^|\s)is($|\s)/i.test(category)))
    || (filter === "Med bilder" && area.imageCount > 0)
    || (filter === "Access" && Boolean(area.accessSlug));
  return matchesQuery && matchesFilter;
}

function areaQualityScore(area: AreaSummary) {
  const warnings = area.categories.join(" ");
  const stars = Number(warnings.match(/(\d)\s*stjärn/i)?.[1] || 0);
  return Math.min(100,
    (area.coordinates?.latitude != null && area.coordinates.longitude != null ? 18 : 0)
    + (area.imageCount > 0 ? 18 : 0)
    + (area.imageCount > 2 ? 4 : 0)
    + (area.routeCount > 0 ? 10 : 0)
    + (area.routeCount >= 10 ? 5 : 0)
    + (area.description.length >= 100 ? 12 : 0)
    + (!/saknar|behöver kvalitetssäkras|bimbo/i.test(warnings) ? 28 : 0)
    + Math.min(5, stars * 2)
  );
}

export function GuideApp({ areas, initialArea }: { areas: AreaSummary[]; initialArea: Area | null }) {
  const [locale, setLocale] = useState<Locale>("sv");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Alla");
  const [sort, setSort] = useState<"Kvalitet" | "A–Ö" | "Flest leder">("Kvalitet");
  const [selected, setSelected] = useState<Area | null>(initialArea);
  const [routeSeed, setRouteSeed] = useState<{ slug: string; value: string } | null>(null);
  const [showLanding, setShowLanding] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [accessResult, setAccessResult] = useState<{ slug: string; info: AccessInfo | null } | null>(null);
  const selectedAccessSlug = selected?.access.federationSlug || null;
  const access = accessResult?.slug === selectedAccessSlug ? accessResult.info : null;

  useEffect(() => {
    const saved = window.localStorage.getItem("sverigeklattraren-language") || window.localStorage.getItem("sverigeforaren-language");
    const shouldUseEnglish = saved === "en" || (!saved && navigator.language.toLocaleLowerCase().startsWith("en"));
    const timer = window.setTimeout(() => { if (shouldUseEnglish) setLocale("en"); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("sverigeklattraren-language", locale);
  }, [locale]);

  const filtered = useMemo(() => areas.filter((area) => areaMatches(area, query, filter)).sort((left, right) => {
    if (sort === "A–Ö") return left.name.localeCompare(right.name, "sv");
    if (sort === "Flest leder") return right.routeCount - left.routeCount || left.name.localeCompare(right.name, "sv");
    return areaQualityScore(right) - areaQualityScore(left) || right.routeCount - left.routeCount || left.name.localeCompare(right.name, "sv");
  }), [areas, filter, query, sort]);
  const displayedAreas = useMemo(() => {
    if (!selected || query.trim() || !filtered.some((area) => area.slug === selected.slug)) return filtered;
    return [filtered.find((area) => area.slug === selected.slug)!, ...filtered.filter((area) => area.slug !== selected.slug)];
  }, [filtered, query, selected]);
  const landingGroups = useMemo(() => {
    const usable = areas.filter((area) => area.routeCount > 0);
    const ranked = (items: AreaSummary[]) => [...items].sort((left, right) => areaQualityScore(right) - areaQualityScore(left) || right.routeCount - left.routeCount).slice(0, 4);
    return [
      { title: tr(locale, "Bäst fältdata", "Best field data"), description: tr(locale, "Karta, bilder och strukturerat innehåll", "Map, images and structured content"), areas: ranked(usable) },
      { title: tr(locale, "Sportklättring", "Sport climbing"), description: tr(locale, "Klippor med sportleder", "Crags with sport routes"), areas: ranked(usable.filter((area) => /\bsport/i.test(`${area.categories.join(" ")} ${area.searchText}`))) },
      { title: "Bouldering", description: tr(locale, "Områden med problem och block", "Areas with problems and boulders"), areas: ranked(usable.filter((area) => area.categories.some((category) => /boulder/i.test(category)))) },
    ].filter((group) => group.areas.length > 0);
  }, [areas, locale]);

  async function selectArea(slug: string, initialRouteQuery = "") {
    const routeSeedFor = (area: Area) => {
      const needle = normalizeSearch(initialRouteQuery);
      if (!needle || needle === normalizeSearch(area.name)) return "";
      return area.routes.some((route) => normalizeSearch(`${route.name} ${route.grade || ""} ${route.number || ""}`).includes(needle))
        ? initialRouteQuery
        : "";
    };
    if (selected?.slug === slug) {
      const value = routeSeedFor(selected);
      setRouteSeed(value ? { slug, value } : null);
      setQuery("");
      setShowLanding(false);
      return;
    }
    setLoading(true);
    const response = await fetch(`/api/areas/${slug}`);
    if (response.ok) {
      const nextArea: Area = await response.json();
      const value = routeSeedFor(nextArea);
      setSelected(nextArea);
      setRouteSeed(value ? { slug, value } : null);
      setQuery("");
      setShowLanding(false);
    }
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
        <button className="brand" type="button" aria-label={tr(locale, "Till Sverigeklättrarens startsida", "Go to the Sverigeklättraren home page")} onClick={() => { setShowLanding(true); setQuery(""); }}>
          <div className="brand-mark">SK</div>
          <div><strong>Sverigeklättraren</strong><small>{tr(locale, "En fork av Sverigeföraren", "A fork of Sverigeföraren")}</small></div>
        </button>
        <label className="search-wrap">
          <span className="sr-only">{tr(locale, "Sök område eller led", "Search for an area or route")}</span>
          <input className="search" value={query} onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (value.trim()) setShowLanding(false);
            const matches = areas.filter((area) => areaMatches(area, value, filter));
            if (value.trim() && matches.length === 1) void selectArea(matches[0].slug, value.trim());
          }} placeholder={tr(locale, "Sök område, led eller grad…", "Search area, route or grade…")} />
        </label>
        <div className="header-actions">
          <div className="language-switch" aria-label={tr(locale, "Välj språk", "Choose language")}><button type="button" className={locale === "sv" ? "active" : ""} onClick={() => setLocale("sv")} aria-pressed={locale === "sv"}>SV</button><button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button></div>
          <button className="ghost-button" type="button" aria-label={tr(locale, "Om projektet", "About the project")} onClick={() => setShowAbout(true)}><span className="desktop-label">{tr(locale, "Om projektet", "About")}</span><span className="mobile-label" aria-hidden="true">{tr(locale, "Om", "About")}</span></button>
          <button className="primary-button" type="button" aria-label={showLanding ? tr(locale, "Välj område för att föreslå en ändring", "Choose an area before suggesting an edit") : tr(locale, "Föreslå ändring", "Suggest an edit")} onClick={() => { if (showLanding) { setShowLanding(false); setQuery(""); } else setShowSuggestion(true); }}><span className="desktop-label">{showLanding ? tr(locale, "Välj område", "Choose area") : tr(locale, "Föreslå ändring", "Suggest an edit")}</span><span className="mobile-label" aria-hidden="true">{showLanding ? tr(locale, "Välj", "Choose") : tr(locale, "Ändra", "Edit")}</span></button>
        </div>
      </header>

      {showLanding ? <main className="landing-page">
        <section className="landing-hero">
          <span className="eyebrow">{tr(locale, "Öppen klätterkunskap", "Open climbing knowledge")}</span>
          <h1>{tr(locale, "Hitta klippan.", "Find the crag.")}<br />{tr(locale, "Hitta leden.", "Find the route.")}</h1>
          <p>{tr(locale, `Sverigeklättraren är en modern fork av den öppna Sverigeföraren. Sök bland ${areas.length} områden, välj sektor och se skissen tillsammans med lederna.`, `Sverigeklättraren is a modern fork of the open Sverigeföraren archive. Search ${areas.length} areas, choose a sector and view the topo together with its routes.`)}</p>
          <div className="landing-actions"><button className="primary-button" type="button" onClick={() => setShowLanding(false)}>{tr(locale, "Utforska alla områden", "Explore all areas")}</button><button className="ghost-button" type="button" onClick={() => setShowAbout(true)}>{tr(locale, "Så fungerar projektet", "How it works")}</button></div>
          <div className="landing-stats"><div><strong>{areas.length}</strong><span>{tr(locale, "områden", "areas")}</span></div><div><strong>{areas.reduce((sum, area) => sum + area.routeCount, 0)}</strong><span>{tr(locale, "leder & problem", "routes & problems")}</span></div><div><strong>2006→2026</strong><span>{tr(locale, "öppen kunskap", "open knowledge")}</span></div></div>
        </section>
        <section className="landing-featured" aria-labelledby="featured-title"><div><span className="eyebrow">{tr(locale, "Börja utforska", "Start exploring")}</span><h2 id="featured-title">{tr(locale, "Hitta efter klätterdag", "Choose your climbing day")}</h2></div><div className="landing-groups">{landingGroups.map((group) => <section key={group.title}><div><h3>{group.title}</h3><p>{group.description}</p></div><div className="landing-area-grid">{group.areas.map((area) => <button type="button" key={area.id} onClick={() => selectArea(area.slug)}><span><strong>{locale === "en" ? area.translations?.en?.name?.text || area.name : area.name}</strong><small>{area.routeCount} {tr(locale, "leder", "routes")} · {area.categories.slice(0, 1).join("") || tr(locale, "Sverige", "Sweden")}</small></span><b title={tr(locale, "Beräknad kvalitet på fältdata", "Estimated field-data quality")}>{areaQualityScore(area)}%</b></button>)}</div></section>)}</div></section>
      </main> : <div className="workspace">
        <aside className="area-nav">
          <div className="nav-kicker">{filtered.length} {tr(locale, "av", "of")} {areas.length} {tr(locale, "områden", "areas")}</div>
          <div className="filter-row" aria-label={tr(locale, "Filtrera områden", "Filter areas")}>
            {["Alla", "Klippa", "Boulder", "Sport", "Trad", "Is", "Med bilder", "Access"].map((option) => (
              <button key={option} className={`filter-chip ${filter === option ? "active" : ""}`} type="button" onClick={() => setFilter(option)}>{locale === "en" ? ({ Alla: "All", Klippa: "Crags", Boulder: "Boulder", Sport: "Sport", Trad: "Trad", Is: "Ice", "Med bilder": "With images", Access: "Access" } as Record<string, string>)[option] : option}</button>
            ))}
          </div>
          <div className="sort-row" aria-label={tr(locale, "Sortera områden", "Sort areas")}>{(["Kvalitet", "A–Ö", "Flest leder"] as const).map((option) => <button key={option} className={sort === option ? "active" : ""} type="button" onClick={() => setSort(option)}>{locale === "en" ? ({ Kvalitet: "Quality", "A–Ö": "A–Z", "Flest leder": "Most routes" } as const)[option] : option}</button>)}</div>
          <div className="area-list">
            {displayedAreas.map((area) => (
              <button className={`area-item ${selected?.slug === area.slug ? "active" : ""}`} type="button" key={area.id} onClick={() => selectArea(area.slug)}>
                <strong>{locale === "en" ? area.translations?.en?.name?.text || area.name : area.name}</strong><span className="count-pill">{area.routeCount}</span>
                <span className="area-meta">{area.categories.slice(0, 2).join(" · ") || "Sverige"}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="main-canvas" aria-busy={loading}>
          {selected ? <AreaView key={`${selected.slug}:${routeSeed?.slug === selected.slug ? routeSeed.value : ""}`} area={selected} access={access} initialRouteQuery={routeSeed?.slug === selected.slug ? routeSeed.value : ""} locale={locale} onSuggest={() => setShowSuggestion(true)} /> : <div className="empty">{tr(locale, "Inget område valt.", "No area selected.")}</div>}
        </main>
      </div>}
      {showSuggestion && selected && <SuggestionDialog area={selected} locale={locale} onClose={() => setShowSuggestion(false)} />}
      {showAbout && <AboutDialog locale={locale} onClose={() => setShowAbout(false)} />}
    </div>
  );
}

function AboutDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="modal-head"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>{tr(locale, "Om projektet", "About the project")}</span><h2 id="about-title">{tr(locale, "En agentdriven wiki för kunskap som annars försvinner", "An agent-driven wiki for knowledge that would otherwise disappear")}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={tr(locale, "Stäng", "Close")}>×</button></div>
        <p>{tr(locale, "Sverigeklättraren är en modern, agentdriven fork av Sverigeföraren. Den nya siten vidareutvecklar det öppna förarinnehållet, medan Sverigeföraren bevaras som namn på originalet och källan.", "Sverigeklättraren is a modern, agent-driven fork of Sverigeföraren. The new site develops the open guide content further, while Sverigeföraren remains the name of the original and its source material.")}</p>
        <p>{tr(locale, "Sverigeföraren.se grundades 2006 av Niclas Emdelius och Per Lindh, såldes 2013 och förföll därefter. En öppen ögonblicksbild från 2014 finns kvar: hundratals områden, tusentals leder, bilder och topos – värdefull kunskap fångad i en åldrad MediaWiki.", "Sverigeföraren.se was founded in 2006 by Niclas Emdelius and Per Lindh, sold in 2013 and subsequently fell into disrepair. An open snapshot from 2014 remains: hundreds of areas, thousands of routes, images and topos — valuable knowledge trapped in an ageing MediaWiki.")}</p>
        <p>{tr(locale, "Projektet är en konkret take på en LLM-baserad wiki. Codex har använts för att bygga om hela produkten och OpenAI API driver agenter som gör ostrukturerat arv till källspårbar, levande kunskap utan att skriva över originalet.", "This project is a practical take on an LLM-based wiki. Codex was used to rebuild the product, while the OpenAI API powers agents that turn an unstructured legacy into traceable, living knowledge without overwriting the original.")}</p>

        <h3>{tr(locale, "Tre agenter, ett granskningsbart flöde", "Three agents, one reviewable workflow")}</h3>
        <ul>
          <li><strong>{tr(locale, "Importagenten", "The import agent")}</strong> {tr(locale, "tolkar MediaWiki-mallar och lös text, strukturerar områden, sektorer och leder samt läser lednummer ur skisser med vision.", "interprets MediaWiki templates and loose text, structures areas, sectors and routes, and reads route numbers from topos using vision.")}</li>
          <li><strong>{tr(locale, "Kvalitetsagenten", "The quality agent")}</strong> {tr(locale, "letar efter motsägelser, saknade källor, dålig formatering och osäkra relationer. Varje slutsats sparas med metod, belägg och konfidens.", "looks for contradictions, missing sources, poor formatting and uncertain relations. Every conclusion records its method, evidence and confidence.")}</li>
          <li><strong>{tr(locale, "Redaktörsagenten", "The editor agent")}</strong> {tr(locale, "förvandlar användarens fritext till en precis ändring, ställer följdfrågor när underlaget inte räcker och skapar en GitHub Pull Request med diff, källor och granskningsresultat.", "turns a user's free text into a precise edit, asks follow-up questions when evidence is insufficient and creates a GitHub Pull Request with its diff, sources and review result.")}</li>
        </ul>

        <h3>{tr(locale, "Byggd för verkligheten vid klippan", "Built for the reality at the crag")}</h3>
        <p>{tr(locale, "Resultatet bedöms inte som en lyckad import förrän en klättrare kan hitta klippan, välja rätt sektor, se rätt skiss och identifiera rätt led. Ledkort visar beskrivning och källor; beta är dold tills användaren själv väljer att se den. Aktuell access hämtas från Svenska Klätterförbundet med synligt uppdateringsdatum.", "An import is not considered successful until a climber can find the crag, choose the correct sector, view the right topo and identify the route. Route cards show descriptions and sources; beta stays hidden until explicitly requested. Current access information is fetched from the Swedish Climbing Federation with a visible update date.")}</p>

        <h3>{tr(locale, "Git är wikins minne", "Git is the wiki's memory")}</h3>
        <p>{tr(locale, "Den publicerade kunskapsdatabasen består av versionsstyrda JSON-dokument. Uppgifter kan ha flera källor per fält, och varje agentändring blir en diff och en commit. GPT-5.6 får föreslå struktur och samband men är aldrig själv en faktakälla. Access, parkering, avstängningar och annan säkerhetskritisk information kräver mänskligt godkännande.", "The published knowledge base consists of version-controlled JSON documents. Fields may cite multiple sources, and every agent edit becomes a diff and a commit. GPT-5.6 may propose structure and relationships but is never itself a factual source. Access, parking, closures and other safety-critical information always require human approval.")}</p>
        <p>{tr(locale, "Samma arkitektur kan återuppliva andra övergivna kunskapsbaser: bevara originalet, importera med agenter, spåra varje påstående och låt människor bidra på sitt eget språk.", "The same architecture can revive other abandoned knowledge bases: preserve the original, import with agents, trace every claim and let people contribute in their own language.")}</p>
        <p><strong>{tr(locale, "Licens för innehåll:", "Content licence:")}</strong> GNU Free Documentation License 1.3. {tr(locale, "Förartexter, beskrivningar och översättningar förblir fria. Själva sajten, designen och agentverktygen är proprietära och får inte återanvändas utan tillstånd. Externa källor behåller sin egen attribution och licensmetadata.", "Guide text, descriptions and translations remain free. The website software, design and agent tooling are proprietary and may not be reused without permission. External sources retain their own attribution and licence metadata.")}</p>
        <a className="source-link" href="https://github.com/nicemd/Sverigeklattraren/blob/main/CONTENT_LICENSE.md" target="_blank" rel="noreferrer"><span>{tr(locale, "Fullständiga licensvillkor", "Full licence terms")}</span><span>↗</span></a>
        <a className="source-link" href="https://github.com/nicemd/Sverigeklattraren" target="_blank" rel="noreferrer"><span>{tr(locale, "Projektets Git-repository", "Project Git repository")}</span><span>↗</span></a>
      </section>
    </div>
  );
}

function AreaMap({ area, locale }: { area: Area; locale: Locale }) {
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
  return <div id="area-map" ref={mapRef} aria-label={`${tr(locale, "Karta över", "Map of")} ${localized(area, locale, "name")}`} />;
}

function AreaView({ area, access, initialRouteQuery, locale, onSuggest }: { area: Area; access: AccessInfo | null; initialRouteQuery: string; locale: Locale; onSuggest: () => void }) {
  const routeCount = area.routes.length;
  const [runtimeTranslation, setRuntimeTranslation] = useState(area.translations?.en);
  const [translationStatus, setTranslationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [translatingRouteId, setTranslatingRouteId] = useState<string | null>(null);
  const [translationRetry, setTranslationRetry] = useState(0);
  const areaTranslation = locale === "en" ? runtimeTranslation : undefined;
  const areaName = locale === "en" ? areaTranslation?.name?.text || area.name : area.name;
  const areaDescription = locale === "en" ? areaTranslation?.description?.text || area.description : area.description;
  const sectionTitle = (section: Area["sections"][number]) => areaTranslation?.sections?.[section.id]?.title?.text || section.title;
  const sectionBody = (section: Area["sections"][number]) => areaTranslation?.sections?.[section.id]?.body?.text || section.body;
  const routeName = (route: Area["routes"][number]) => areaTranslation?.routes?.[route.id]?.name?.text || route.name;
  const routeDescription = (route: Area["routes"][number]) => areaTranslation?.routes?.[route.id]?.description?.text || route.description;
  const routeBeta = (route: Area["routes"][number]) => areaTranslation?.routes?.[route.id]?.beta?.text || route.beta;
  const imageCaption = (image: Area["images"][number]) => areaTranslation?.images?.[image.filename]?.caption?.text || image.caption;
  const hasEnglishContent = Boolean(areaTranslation?.description || areaTranslation?.sections || areaTranslation?.routes);
  const [routeQuery, setRouteQuery] = useState(initialRouteQuery);
  const [discipline, setDiscipline] = useState<"all" | "route" | "problem">("all");
  const [sectorId, setSectorId] = useState("all");
  const [openImage, setOpenImage] = useState<Area["images"][number] | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showBeta, setShowBeta] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);

  useEffect(() => {
    if (locale !== "en" || runtimeTranslation?.description) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setTranslationStatus("loading"); });
    fetch(`/api/translations/${encodeURIComponent(area.slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then(({ translation }) => { if (!cancelled) { setRuntimeTranslation((current) => ({ ...current, ...translation, routes: { ...(current?.routes || {}), ...(translation.routes || {}) } })); setTranslationStatus("idle"); } })
      .catch(() => { if (!cancelled) setTranslationStatus("error"); });
    return () => { cancelled = true; };
  }, [area.slug, locale, runtimeTranslation?.description, translationRetry]);
  const normalizedRouteQuery = normalizeSearch(routeQuery);
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
    const haystack = normalizeSearch(`${route.name} ${routeName(route)} ${route.grade} ${route.type} ${route.description} ${routeDescription(route)}`);
    return matchesDiscipline && matchesSector && (!normalizedRouteQuery || haystack.includes(normalizedRouteQuery));
  });
  const exactRoute = visibleRoutes.length === 1 ? visibleRoutes[0] : null;
  const exactSector = exactRoute?.sectorId ? area.sections.find((section) => section.id === exactRoute.sectorId) : null;
  const sectorRoutes = exactRoute?.sectorId ? area.routes.filter((route) => route.sectorId === exactRoute.sectorId && route.kind === exactRoute.kind) : [];
  const exactIndex = exactRoute ? sectorRoutes.findIndex((route) => route.id === exactRoute.id) : -1;
  const exactSourceIds = exactRoute ? [...new Set([exactRoute.source.id, ...Object.values(exactRoute.fieldSources || {}).flat()])] : [];
  const selectedSector = sectorId !== "all" ? sectionById.get(sectorId) : null;
  const selectedSectorRoutes = selectedSector ? visibleRoutes : [];
  const imagesForSector = (targetSectorId: string) => {
    const targetRouteIds = new Set(area.routes.filter((route) => route.sectorId === targetSectorId && (discipline === "all" || route.kind === discipline)).map((route) => route.id));
    const candidates = area.images.filter((image) => !image.missing && image.imageKind !== "photo" && image.imageKind !== "map");
    const rank = (images: Area["images"]) => uniqueImages(images).sort((left, right) => {
      const score = (image: Area["images"][number]) => {
        const relations = (image.routeRelations || []).filter((relation) => targetRouteIds.has(relation.routeId));
        return Math.max(0, ...relations.map((relation) => relation.confidence)) * 100
          + relations.filter((relation) => relation.method === "vision").length * 4
          + relations.length * 0.1
          - (/^\d+\s*(?:width)?px$/i.test(image.caption.trim()) ? 20 : 0);
      };
      return score(right) - score(left);
    });
    const direct = candidates.filter((image) => image.sectorId === targetSectorId);
    const related = candidates.filter((image) => image.routeRelations?.some((relation) => targetRouteIds.has(relation.routeId) && relation.confidence >= 0.7)
      || image.routeIds?.some((routeId) => targetRouteIds.has(routeId)));
    if (related.length) return rank(related);
    if (direct.length) return rank(direct);
    return [];
  };
  const selectedSectorImages = selectedSector ? imagesForSector(selectedSector.id) : [];
  const overviewImages = uniqueImages(area.images.filter((image) => !image.missing && image.imageKind === "map"));
  const overviewCaption = (image: Area["images"][number]) => /^\d+\s*(?:width)?px$/i.test(imageCaption(image).trim())
    ? tr(locale, "Områdesöversikt", "Area overview") : imageCaption(image) || tr(locale, "Områdesöversikt", "Area overview");
  const selectedRoutesByImage = new Map<string, Area["routes"]>();
  const selectedRoutesWithoutImage: Area["routes"] = [];
  selectedSectorImages.forEach((image) => selectedRoutesByImage.set(image.filename, []));
  selectedSectorRoutes.forEach((route) => {
    const bestImage = selectedSectorImages
      .map((image) => ({ image, confidence: routeImageRelation(image, route.id)?.confidence || 0 }))
      .filter(({ confidence }) => confidence >= 0.7)
      .sort((left, right) => right.confidence - left.confidence)[0]?.image;
    if (bestImage) selectedRoutesByImage.get(bestImage.filename)?.push(route);
    else selectedRoutesWithoutImage.push(route);
  });
  const routesForTopo = (image: Area["images"][number]) => area.routes.filter((route) =>
    (discipline === "all" || route.kind === discipline)
    && (routeImageRelation(image, route.id)?.confidence || 0) >= 0.7
  );
  const renderTopoVisual = (image: Area["images"][number], sectorTitle: string) => {
    return <div className="topo-visual">
      <button className="topo-image-open" type="button" onClick={() => openImageViewer(image)} aria-label={`${tr(locale, "Öppna skiss för", "Open topo for")} ${sectorTitle} ${tr(locale, "i full storlek", "full size")}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/media/${encodeURIComponent(image.filename)}`} alt={imageCaption(image) || `${tr(locale, "Skiss över", "Topo of")} ${sectorTitle}`} loading="lazy" />
        <span>{tr(locale, "Öppna stort", "Enlarge")}</span>
      </button>
    </div>;
  };
  const renderRouteRow = (route: Area["routes"][number]) => <button type="button" className={`route-row ${exactRoute?.id === route.id ? "highlighted" : ""}`} key={route.id} onClick={() => openRouteCard(route.id)} aria-label={`${tr(locale, "Öppna fältkort för", "Open field card for")} ${routeName(route)}`}>
    <span className="route-number" title={route.number ? tr(locale, "Nummer i originalets skiss/lista", "Number in the original topo/list") : tr(locale, "Lednummer saknas i originalkällan", "Route number missing from the original source")}>{route.number || "–"}</span>
    <span className="route-name"><strong>{routeName(route)}</strong><small>{tr(locale, "Visa fältkort", "View field card")}{area.images.some((image) => image.imageKind !== "photo" && image.imageKind !== "map" && (routeImageRelation(image, route.id)?.confidence || 0) >= 0.7) ? tr(locale, " · finns i skissen", " · shown in topo") : ""}</small>{routeDescription(route) && <span className="route-inline-description">{routeDescription(route)}</span>}</span>
    <span className="grade">{route.grade || "–"}</span>
    <span className="route-length">{route.length ? `${route.length} m` : route.type}</span>
  </button>;
  const directions = area.sections.find((section) => /vägbeskrivning|hitta hit|anmarsch/i.test(section.title));
  const translatedDirections = directions ? areaTranslation?.sections?.[directions.id]?.body?.text : undefined;
  const routeTotal = area.routes.filter((route) => route.kind === "route").length;
  const problemTotal = area.routes.filter((route) => route.kind === "problem").length;
  const disciplineTotal = discipline === "route" ? routeTotal : discipline === "problem" ? problemTotal : routeCount;
  const selectedRoute = selectedRouteId ? area.routes.find((route) => route.id === selectedRouteId) || null : null;
  const routeNavigationList = selectedRoute && visibleRoutes.some((route) => route.id === selectedRoute.id) ? visibleRoutes : area.routes;
  const selectedRouteNavigationIndex = selectedRoute ? routeNavigationList.findIndex((route) => route.id === selectedRoute.id) : -1;
  const previousRoute = selectedRouteNavigationIndex > 0 ? routeNavigationList[selectedRouteNavigationIndex - 1] : null;
  const nextRoute = selectedRouteNavigationIndex >= 0 && selectedRouteNavigationIndex < routeNavigationList.length - 1 ? routeNavigationList[selectedRouteNavigationIndex + 1] : null;
  const selectedRouteSectorList = selectedRoute?.sectorId ? area.routes.filter((route) => route.sectorId === selectedRoute.sectorId) : [];
  const selectedRouteSectorIndex = selectedRoute ? selectedRouteSectorList.findIndex((route) => route.id === selectedRoute.id) : -1;
  const selectedRouteTranslation = selectedRoute ? runtimeTranslation?.routes?.[selectedRoute.id] : undefined;
  const selectedRouteTranslationComplete = Boolean(selectedRoute
    && (!selectedRoute.description || selectedRouteTranslation?.description)
    && (!selectedRoute.beta || selectedRouteTranslation?.beta));

  useEffect(() => {
    if (locale !== "en" || !selectedRoute || (!selectedRoute.description && !selectedRoute.beta) || selectedRouteTranslationComplete) return;
    let cancelled = false;
    const requestedRouteId = selectedRoute.id;
    Promise.resolve().then(() => { if (!cancelled) setTranslatingRouteId(requestedRouteId); });
    fetch(`/api/translations/${encodeURIComponent(area.slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routeId: selectedRoute.id }) })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then(({ translation }) => { if (!cancelled) setRuntimeTranslation((current) => ({ ...current, routes: { ...(current?.routes || {}), ...(translation.routes || {}) } })); })
      .catch(() => { /* Swedish source remains visible when a runtime translation fails. */ })
      .finally(() => { if (!cancelled) setTranslatingRouteId(null); });
    return () => { cancelled = true; };
  }, [area.slug, locale, selectedRoute, selectedRouteTranslationComplete]);
  const selectedRouteSector = selectedRoute?.sectorId ? sectionById.get(selectedRoute.sectorId) : null;
  const overlayFromState = (state: unknown): GuideOverlayState | null => {
    if (!state || typeof state !== "object") return null;
    const overlay = (state as Record<string, unknown>)[overlayHistoryKey];
    return overlay && typeof overlay === "object" ? overlay as GuideOverlayState : null;
  };
  const setOverlayHistory = (overlay: GuideOverlayState, replace = false) => {
    const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history[replace ? "replaceState" : "pushState"]({ ...state, [overlayHistoryKey]: overlay }, "");
  };
  const openRouteCard = (routeId: string, replace = false) => {
    setSelectedRouteId(routeId);
    setOpenImage(null);
    setShowBeta(false);
    setOverlayHistory({ areaSlug: area.slug, routeId }, replace);
  };
  const openImageViewer = (image: Area["images"][number]) => {
    setOpenImage(image);
    setOverlayHistory({ areaSlug: area.slug, routeId: selectedRouteId || undefined, imageFilename: image.filename });
  };
  const closeRouteCard = () => {
    const overlay = overlayFromState(window.history.state);
    if (overlay?.areaSlug === area.slug && overlay.routeId) window.history.back();
    else setSelectedRouteId(null);
  };
  const closeImageViewer = () => {
    const overlay = overlayFromState(window.history.state);
    if (overlay?.areaSlug === area.slug && overlay.imageFilename) window.history.back();
    else setOpenImage(null);
  };

  useEffect(() => {
    const restoreOverlay = (event: PopStateEvent) => {
      const overlay = overlayFromState(event.state);
      setSelectedRouteId(overlay?.areaSlug === area.slug && overlay.routeId && area.routes.some((route) => route.id === overlay.routeId) ? overlay.routeId : null);
      setOpenImage(overlay?.areaSlug === area.slug && overlay.imageFilename ? area.images.find((image) => image.filename === overlay.imageFilename) || null : null);
      setShowBeta(false);
    };
    window.addEventListener("popstate", restoreOverlay);
    return () => window.removeEventListener("popstate", restoreOverlay);
  }, [area.images, area.routes, area.slug]);

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
  const selectedRouteTopoCaption = (image: Area["images"][number]) => {
    const caption = imageCaption(image).trim();
    const genericCaption = !caption
      || /^\d+\s*(?:width)?px$/i.test(caption)
      || normalizeSearch(caption) === normalizeSearch(area.name)
      || normalizeSearch(caption) === normalizeSearch(areaName);
    const subject = selectedRouteSector ? sectionTitle(selectedRouteSector) : areaName;
    return genericCaption ? `${tr(locale, "Skiss över", "Topo of")} ${subject}` : caption;
  };
  const selectedRouteType = selectedRoute?.type?.trim();
  const selectedRouteStyle = selectedRouteType
    ? selectedRouteType.charAt(0).toLocaleUpperCase(locale === "sv" ? "sv" : "en") + selectedRouteType.slice(1)
    : selectedRoute?.kind === "problem" ? tr(locale, "Boulderproblem", "Boulder problem") : tr(locale, "Klätterled", "Climbing route");
  const openImageRoutes = openImage ? routesForTopo(openImage) : [];
  const openImageRoute = selectedRoute && openImage && routeImageRelation(openImage, selectedRoute.id) ? selectedRoute : null;
  const openImageRouteColor = openImageRoute?.description.match(/^\(([^)]+)\)/)?.[1] || null;
  const climbingLabel = routeTotal > 0 && problemTotal > 0 ? tr(locale, "Repklättring · Bouldering", "Roped climbing · Bouldering") : problemTotal > 0 ? "Bouldering" : routeTotal > 0 ? tr(locale, "Repklättring", "Roped climbing") : tr(locale, "Svenskt klätterområde", "Swedish climbing area");
  const countLabel = routeTotal > 0 && problemTotal > 0 ? tr(locale, "leder & problem", "routes & problems") : problemTotal > 0 ? "problem" : tr(locale, "leder", "routes");
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
          <h1>{areaName}</h1>
          <p><RichText text={areaDescription} /></p>
          {locale === "en" && <MachineTranslationNote value={areaTranslation?.description} original={area.description} />}
          {locale === "en" && translationStatus === "loading" && <small className="translation-notice">Translating this area with climbing context… Swedish source text remains visible meanwhile.</small>}
          {locale === "en" && translationStatus === "error" && <button type="button" className="translation-retry" onClick={() => { setTranslationStatus("idle"); setTranslationRetry((value) => value + 1); }}>Translation failed · Try again</button>}
          {locale === "en" && !hasEnglishContent && translationStatus === "idle" && <small className="translation-notice">Preparing a context-aware English translation…</small>}
          <div className="hero-stats">
            <div className="hero-stat"><strong>{routeCount}</strong><span>{countLabel}</span></div>
            <div className="hero-stat"><strong>{area.images.length}</strong><span>{tr(locale, "bilder & topos", "images & topos")}</span></div>
            <div className="hero-stat"><strong>{new Set(area.routes.map((route) => route.grade).filter(Boolean)).size}</strong><span>{tr(locale, "grader", "grades")}</span></div>
          </div>
        </article>
        <div className="map-card">
          {area.coordinates?.latitude && area.coordinates.longitude ? <AreaMap area={area} locale={locale} /> : <div className="empty">{tr(locale, "Koordinater saknas i originalkällan.", "Coordinates are missing from the original source.")}</div>}
          <div className="map-overlay"><strong>{areaName}</strong><span>{area.coordinates?.latitude?.toFixed(4) || "–"}, {area.coordinates?.longitude?.toFixed(4) || "–"}</span></div>
        </div>
      </section>
      <section className="arrival-access-grid">
        <section className="arrival-card" aria-labelledby="arrival-title">
          <div className="arrival-summary">
            <div><span className="eyebrow" style={{ color: "var(--forest)" }}>{tr(locale, "På väg till berget", "Getting to the crag")}</span><h2 id="arrival-title">{tr(locale, "Hitta klippan", "Find the crag")}</h2></div>
            {area.coordinates?.latitude && area.coordinates.longitude && <a className="primary-button directions-button" href={`https://www.google.com/maps/dir/?api=1&destination=${area.coordinates.latitude},${area.coordinates.longitude}`} target="_blank" rel="noreferrer">{tr(locale, "Vägbeskrivning", "Directions")} ↗</a>}
          </div>
          <div className="arrival-copy">
            <StructuredProse blocks={translatedDirections ? undefined : directions?.blocks} fallback={translatedDirections || directions?.body || tr(locale, "Originalkällan saknar en strukturerad vägbeskrivning. Använd kartpunkten med försiktighet och föreslå gärna en verifierad anmarsch.", "The original source has no structured directions. Use the map point with caution and consider suggesting a verified approach.")} />
            <small>{tr(locale, "Vägbeskrivningen är från 2014. Kontrollera alltid aktuell access före avfärd.", "The directions are from 2014. Always check current access information before departure.")}</small>
          </div>
        </section>
        <article className="panel access-card">
          <span className="eyebrow" style={{ color: "#8c5c13" }}>{tr(locale, "Aktuell access", "Current access")}</span>
          <div className="status-line"><span className="status-dot" /><strong>{access?.status || (area.access.federationSlug ? tr(locale, "Hämtar från Klätterförbundet…", "Fetching from the Swedish Climbing Federation…") : tr(locale, "Ingen direktkoppling ännu", "No direct integration yet"))}</strong></div>
          <p>{access?.summary || area.access.legacyText || tr(locale, "Det saknas kopplad accessinformation för området. Kontrollera alltid lokala regler före besöket.", "No linked access information is available for this area. Always check local rules before visiting.")}</p>
          {access && <a className="source-link" href={access.url} target="_blank" rel="noreferrer"><span>{tr(locale, "Klätterförbundets accessdatabas", "Swedish Climbing Federation access database")}<br /><small>{tr(locale, "Uppdaterad", "Updated")} {formatDate(access.sourceUpdatedAt, locale)} · {tr(locale, "hämtad", "fetched")} {formatDate(access.fetchedAt, locale)}</small></span><span>↗</span></a>}
        </article>
      </section>

      {looseSections.length > 0 && <section className={`legacy-notes area-notes ${showAllNotes ? "expanded" : "collapsed"}`} aria-label={tr(locale, "Anteckningar från originalföraren", "Notes from the original guide")}>
        <div className="legacy-notes-heading"><strong>{tr(locale, "Anteckningar från originalföraren", "Notes from the original guide")}</strong><span>{tr(locale, "Historiskt, löst strukturerat material", "Historic, loosely structured material")}</span></div>
        {(showAllNotes ? looseSections : looseSections.slice(0, 3)).map((section) => <article key={section.id}><h3>{sectionTitle(section)}</h3><p><RichText text={sectionBody(section)} /></p></article>)}
        {looseSections.length > 3 && <button className="notes-toggle" type="button" onClick={() => setShowAllNotes((value) => !value)} aria-expanded={showAllNotes}>
          {showAllNotes ? tr(locale, "Visa färre anteckningar", "Show fewer notes") : `${tr(locale, "Visa alla anteckningar", "Show all notes")} (${looseSections.length})`}
        </button>}
      </section>}

      {overviewImages.length > 0 && <section className="area-overview" aria-labelledby="area-overview-title">
        <div className="area-overview-heading">
          <div><span className="eyebrow">{tr(locale, "Områdesöversikt", "Area overview")}</span><h2 id="area-overview-title">{tr(locale, "Hitta mellan väggarna", "Find your way between the walls")}</h2></div>
          <p>{tr(locale, "Originalförarens översikt hjälper dig att orientera dig mellan väggar och sektorer. Tryck på bilden för full storlek.", "The original guide's overview helps you navigate between walls and sectors. Tap the image for full size.")}</p>
        </div>
        <div className={"area-overview-images " + (overviewImages.length === 1 ? "single" : "")}>
          {overviewImages.map((image) => <button type="button" key={image.filename} onClick={() => setOpenImage(image)} aria-label={tr(locale, "Öppna områdesöversikt", "Open area overview") + ": " + overviewCaption(image)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={"/api/media/" + encodeURIComponent(image.filename)} alt={overviewCaption(image)} loading="lazy" />
            <span>{overviewCaption(image)}</span>
            <em>{tr(locale, "Öppna stort", "Enlarge")}</em>
          </button>)}
        </div>
      </section>}

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>{tr(locale, "På klippan", "At the crag")}</span><h2>{routeCount ? tr(locale, "Hitta leden", "Find the route") : tr(locale, "Originalförarens anteckningar", "Notes from the original guide")}</h2></div><span>{tr(locale, "Från Sverigeföraren 2014", "From Sverigeföraren 2014")}</span></div>
          {routeCount > 0 && <div className="route-finder">
            {routeTotal > 0 && problemTotal > 0 && <div className="discipline-tabs" aria-label={tr(locale, "Välj klätterform", "Choose climbing discipline")}>
              <button type="button" className={discipline === "all" ? "active" : ""} onClick={() => { setDiscipline("all"); setSectorId("all"); }}>{tr(locale, "Allt", "All")} <small>{routeCount}</small></button>
              <button type="button" className={discipline === "route" ? "active" : ""} onClick={() => { setDiscipline("route"); setSectorId("all"); }}>{tr(locale, "Repklättring", "Roped climbing")} <small>{routeTotal}</small></button>
              <button type="button" className={discipline === "problem" ? "active" : ""} onClick={() => { setDiscipline("problem"); setSectorId("all"); }}>Bouldering <small>{problemTotal}</small></button>
            </div>}
            <label>
              <span className="sr-only">{tr(locale, "Sök led i", "Search routes at")} {areaName}</span>
              <input value={routeQuery} onChange={(event) => setRouteQuery(event.target.value)} placeholder={`${tr(locale, "Sök bland", "Search")} ${routeCount} ${countLabel}…`} />
              {routeQuery && <button className="route-search-clear" type="button" onClick={() => setRouteQuery("")} aria-label={tr(locale, "Rensa ledsökning", "Clear route search")}>×</button>}
            </label>
            <div className="sector-tabs" aria-label={tr(locale, "Välj sektor", "Choose sector")}>
              <button type="button" className={sectorId === "all" ? "active" : ""} onClick={() => setSectorId("all")}>{tr(locale, "Alla sektorer", "All sectors")} <small>{disciplineTotal}</small></button>
              {sectors.map((sector) => <button type="button" key={sector.id} className={sectorId === sector.id ? "active" : ""} onClick={() => setSectorId(sector.id)}>{areaTranslation?.sections?.[sector.id]?.title?.text || sector.title} <small>{sector.count}</small></button>)}
            </div>
          </div>}
          {exactRoute && (
            <div className="field-result" role="status">
              <span className="field-result-kicker">{exactSector ? `${tr(locale, "Sektor", "Sector")} ${sectionTitle(exactSector)}` : tr(locale, "Sektor saknas i källan", "Sector missing from source")}</span>
              <strong>{routeName(exactRoute)} · {exactRoute.grade || tr(locale, "ograderad", "ungraded")}</strong>
              {exactSector?.body && <p><RichText text={sectionBody(exactSector)} /></p>}
              {exactIndex >= 0 && <div className="route-neighbours"><span>{tr(locale, "Vänster", "Left")}: <b>{sectorRoutes[exactIndex - 1] ? routeName(sectorRoutes[exactIndex - 1]) : tr(locale, "sektorgräns", "sector boundary")}</b></span><span>{tr(locale, "Position", "Position")} <b>{exactIndex + 1} {tr(locale, "av", "of")} {sectorRoutes.length}</b> {tr(locale, "i sektorn", "in sector")}</span><span>{tr(locale, "Höger", "Right")}: <b>{sectorRoutes[exactIndex + 1] ? routeName(sectorRoutes[exactIndex + 1]) : tr(locale, "sektorgräns", "sector boundary")}</b></span></div>}
              <div className="route-citations"><span>{tr(locale, "Källor för leden", "Sources for this route")}</span>{exactSourceIds.map((sourceId) => {
                const source = area.provenance.sources.find((item) => item.id === sourceId);
                if (!source) return null;
                const fields = Object.entries(exactRoute.fieldSources || {}).filter(([, ids]) => ids?.includes(sourceId)).map(([field]) => field);
                const href = source.url || `/api/source/${area.slug}`;
                return <a key={sourceId} href={href} target="_blank" rel="noreferrer">{source.title}{fields.length ? ` · ${fields.join(", ")}` : tr(locale, " · importerad led", " · imported route")} ↗</a>;
              })}</div>
            </div>
          )}
          {selectedSector && selectedSectorImages.length > 0 && (
            <section className="sector-topo" aria-labelledby="selected-sector-title">
              <div className="sector-topo-heading">
                <div><span className="eyebrow">{tr(locale, "Vald sektor", "Selected sector")}</span><h3 id="selected-sector-title">{sectionTitle(selectedSector)}</h3></div>
                <p><RichText text={sectionBody(selectedSector) || tr(locale, "Sektorsbeskrivning saknas i originalet.", "The original has no sector description.")} /></p>
              </div>
              <div className="sector-topo-groups">
                {selectedSectorImages.map((image) => {
                  const relatedRoutes = selectedRoutesByImage.get(image.filename) || [];
                  return <article className="sector-topo-route-group" key={image.filename}>
                    <div className="sector-topo-image">
                      {renderTopoVisual(image, sectionTitle(selectedSector))}
                      <div className="sector-topo-caption"><strong>{imageCaption(image) || `${tr(locale, "Skiss över", "Topo of")} ${sectionTitle(selectedSector)}`}</strong><span>{relatedRoutes.length > 0 ? `${relatedRoutes.length} ${tr(locale, "leder hör till skissen", "routes belong to this topo")}` : tr(locale, "Skissen hör till sektorn, men inga leder har kunnat kopplas säkert.", "The topo belongs to this sector, but no routes could be linked safely.")}</span></div>
                    </div>
                    {relatedRoutes.length > 0 && <div className="route-list sketch-route-list">{relatedRoutes.map(renderRouteRow)}</div>}
                  </article>;
                })}
                {selectedRoutesWithoutImage.length > 0 && <section className="unlinked-sector-routes"><div><strong>{tr(locale, "Övriga leder i sektorn", "Other routes in this sector")}</strong><span>{selectedRoutesWithoutImage.length} {tr(locale, "saknar säker koppling till en skiss", "have no verified topo relation")}</span></div><div className="route-list sketch-route-list">{selectedRoutesWithoutImage.map(renderRouteRow)}</div></section>}
              </div>
            </section>
          )}
          {(!selectedSector || selectedSectorImages.length === 0) && <div className={`route-list ${sectorId !== "all" ? "sector-route-list" : ""}`}>
            {visibleRoutes.map((route, visibleIndex) => (
              <Fragment key={route.id}>
              {(visibleIndex === 0 || visibleRoutes[visibleIndex - 1]?.sectorId !== route.sectorId) && (sectorId === "all" || selectedSectorImages.length === 0) && (() => {
                const allGroupImages = route.sectorId ? imagesForSector(route.sectorId) : [];
                const groupImages = allGroupImages.slice(0, 1);
                const groupSection = route.sectorId ? sectionById.get(route.sectorId) : undefined;
                const groupTitle = groupSection ? sectionTitle(groupSection) : tr(locale, "Övriga leder", "Other routes");
                return <div className={`sector-heading ${groupImages.length ? "with-topos" : ""}`}><strong>{groupTitle}</strong><span><RichText text={groupSection ? sectionBody(groupSection) || tr(locale, "Sektorsbeskrivning saknas i originalet.", "The original has no sector description.") : tr(locale, "Sektorsbeskrivning saknas i originalet.", "The original has no sector description.")} /></span>{groupImages.length > 0 && <div className="sector-heading-topos">{groupImages.map((image) => <div className="sector-heading-topo" key={image.filename}>{renderTopoVisual(image, groupTitle)}<small>{imageCaption(image) || tr(locale, "Sektorskiss", "Sector topo")}{allGroupImages.length > 1 ? ` · +${allGroupImages.length - 1} ${tr(locale, "vid sektorval", "when sector is selected")}` : ""}</small></div>)}</div>}</div>;
              })()}
              {renderRouteRow(route)}
              </Fragment>
            ))}
            {!area.routes.length && <div className="empty">{tr(locale, "Originalet innehåller inga ledposter som säkert kan struktureras. Anteckningar och externa länkar visas ändå ovan.", "The original contains no route entries that can be structured safely. Notes and external links are still shown above.")}</div>}
            {area.routes.length > 0 && !visibleRoutes.length && <div className="empty">{tr(locale, "Ingen led matchar sökningen i vald sektor.", "No route matches the search in the selected sector.")}</div>}
          </div>}
          {area.routes.length > 0 && <div className="list-note">{tr(locale, "Visar", "Showing")} {visibleRoutes.length} {tr(locale, "av", "of")} {area.routes.length}. {tr(locale, "Ledordning och sektortext kommer från originalkällan.", "Route order and sector text come from the original source.")}</div>}
        </article>

        <aside>
          <article className="panel source-card">
            <span className="eyebrow" style={{ color: "var(--forest)" }}>{tr(locale, "Källspårning", "Source tracing")}</span>
            <h2>{area.provenance.sources.length} {area.provenance.sources.length === 1 ? tr(locale, "källa", "source") : tr(locale, "källor", "sources")}</h2>
            <p>{tr(locale, "Legacyuppgifter pekar på originalfilen. Externa fakta spåras per fält på berörd led; en faktareferens ger aldrig rätt att kopiera beskrivning, bild eller topo.", "Legacy facts point to the original file. External facts are traced per field on the affected route; a factual reference never grants permission to copy a description, image or topo.")}</p>
            {area.provenance.sources.map((source) => <a className="source-link" key={source.id} href={source.url || `/api/source/${area.slug}`} target="_blank" rel="noreferrer"><span>{source.title}<br /><small>{source.usage === "fact-reference" ? tr(locale, "Faktareferens · inget material återpublicerat", "Fact reference · no content republished") : `${source.license || tr(locale, "Källmaterial", "Source material")} · ${source.snapshotDate ? `${tr(locale, "ögonblicksbild", "snapshot")} ${source.snapshotDate.slice(0, 4)}` : tr(locale, "spårad källa", "traced source")}`}</small></span><span>↗</span></a>)}
            {area.externalLinks?.map((link) => <a className="source-link external" key={link.url} href={link.url} target="_blank" rel="noreferrer"><span>{link.label || tr(locale, "Extern länk", "External link")}<br /><small>{tr(locale, "Extern länk från originalföraren · materialet återpubliceras inte", "External link from the original guide · content is not republished")}</small></span><span>↗</span></a>)}
            <button className="primary-button" style={{ width: "100%", marginTop: 18 }} type="button" onClick={onSuggest}>{tr(locale, "Föreslå förbättring", "Suggest an improvement")}</button>
          </article>
        </aside>
      </section>
      {openImage && <div className="image-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImageViewer(); }}>
        <section role="dialog" aria-modal="true" aria-label={`${tr(locale, "Skiss eller bild från", "Topo or image from")} ${areaName}`}>
          <div className="image-modal-head"><div><span className="eyebrow">{openImage.sectorId && sectionById.get(openImage.sectorId) ? sectionTitle(sectionById.get(openImage.sectorId)!) : areaName}</span><strong>{selectedRoute ? selectedRouteTopoCaption(openImage) : imageCaption(openImage) || tr(locale, "Skiss från originalföraren", "Topo from the original guide")}</strong></div><button type="button" onClick={closeImageViewer} aria-label={tr(locale, "Stäng skiss", "Close topo")}>×</button></div>
          <div className="image-modal-visual">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${encodeURIComponent(openImage.filename)}`} alt={imageCaption(openImage) || `${tr(locale, "Skiss eller bild från", "Topo or image from")} ${areaName}`} />
          </div>
          {openImageRoutes.length > 0 && <details className="image-modal-annotations"><summary>{tr(locale, "Lednyckel", "Route key")} <span>{openImageRoutes.length} {tr(locale, "leder", "routes")}</span></summary><div>{openImageRoutes.map((route) => <button type="button" key={route.id} onClick={() => openRouteCard(route.id, true)} title={`${tr(locale, "Öppna fältkort för", "Open field card for")} ${routeName(route)}`}><b>{route.number || "–"}</b><span>{routeName(route)}</span>{route.grade && <em>{route.grade}</em>}</button>)}</div></details>}
          {openImageRoute && <div className="image-route-context"><strong>{openImageRoute.number || tr(locale, "Utan nummer", "No number")} · {routeName(openImageRoute)}</strong><span>{openImageRoute.grade || tr(locale, "Ograderad", "Ungraded")}{openImageRouteColor ? ` · ${openImageRouteColor.toLocaleLowerCase("sv")} ${tr(locale, "i originaltopon", "in the original topo")}` : ""}</span></div>}
          <p>{tr(locale, "Lednumren i listan motsvarar originalskissen när ett nummer finns angivet i källan.", "Route numbers in the list match the original topo whenever the source provides a number.")}</p>
        </section>
      </div>}
      {selectedRoute && <div className="route-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRouteCard(); }}>
        <section className="route-detail" key={selectedRoute.id} role="dialog" aria-modal="true" aria-label={`${tr(locale, "Fältkort för", "Field card for")} ${routeName(selectedRoute)}`}>
          <div className="route-detail-head">
            <div><span className="eyebrow">{selectedRouteSector ? sectionTitle(selectedRouteSector) : tr(locale, "Sektor saknas", "Sector missing")}</span><h2>{selectedRoute.number && <span className="route-title-number">{selectedRoute.number}.</span>} {routeName(selectedRoute)}</h2></div>
            <button type="button" onClick={closeRouteCard} aria-label={tr(locale, "Stäng fältkort", "Close field card")}>×</button>
          </div>
          <div className="route-detail-toolbar">
            <div className="route-detail-facts"><strong>{selectedRoute.grade || tr(locale, "Ograderad", "Ungraded")}</strong><span>{selectedRouteStyle}</span>{selectedRoute.length && <span>{selectedRoute.length} m</span>}</div>
            <nav className="route-detail-navigation" aria-label={tr(locale, "Bläddra mellan leder", "Browse routes")}>
              <button type="button" disabled={!previousRoute} onClick={() => { if (previousRoute) openRouteCard(previousRoute.id, true); }} aria-label={previousRoute ? `${tr(locale, "Föregående led", "Previous route")}: ${routeName(previousRoute)}` : tr(locale, "Början av listan", "Start of list")} title={previousRoute ? routeName(previousRoute) : undefined}>←</button>
              <span>{selectedRouteNavigationIndex + 1} / {routeNavigationList.length}</span>
              <button type="button" disabled={!nextRoute} onClick={() => { if (nextRoute) openRouteCard(nextRoute.id, true); }} aria-label={nextRoute ? `${tr(locale, "Nästa led", "Next route")}: ${routeName(nextRoute)}` : tr(locale, "Slutet av listan", "End of list")} title={nextRoute ? routeName(nextRoute) : undefined}>→</button>
            </nav>
          </div>
          <div className="route-detail-context">
            <span><small>{tr(locale, "Sektor", "Sector")}</small><strong>{selectedRouteSector ? sectionTitle(selectedRouteSector) : "–"}</strong></span>
            <span><small>{tr(locale, "Position i sektorn", "Position in sector")}</small><strong>{selectedRouteSectorIndex >= 0 ? `${selectedRouteSectorIndex + 1} ${tr(locale, "av", "of")} ${selectedRouteSectorList.length}` : "–"}</strong></span>
            <span><small>{tr(locale, "Kopplade skisser", "Linked topos")}</small><strong>{selectedRouteImages.length}</strong></span>
            <span><small>{tr(locale, "Spårade källor", "Traced sources")}</small><strong>{selectedRouteSources.length}</strong></span>
          </div>
          {selectedRoute.firstAscent && <p className="first-ascent">{tr(locale, "Förstebestigning", "First ascent")}: <strong>{selectedRoute.firstAscent}</strong></p>}
          {selectedRoute.extraction?.method === "llm" && <p className="extraction-note">{tr(locale, "Strukturerad med OpenAI från originalförarens löptext · konfidens", "Structured with OpenAI from the original guide text · confidence")} {Math.round(selectedRoute.extraction.confidence * 100)} %</p>}
          {routeDescription(selectedRoute) && <div className="route-description"><strong>{tr(locale, "Ledbeskrivning", "Route description")}</strong><p><RichText text={routeDescription(selectedRoute)} /></p>{locale === "en" && <MachineTranslationNote compact value={areaTranslation?.routes?.[selectedRoute.id]?.description} original={selectedRoute.description} />}</div>}
          {locale === "en" && translatingRouteId === selectedRoute.id && <p className="route-translation-status">Translating route description with sector context…</p>}
          {routeBeta(selectedRoute) && <div className="beta-panel">
            {!showBeta ? <button type="button" className="beta-toggle" onClick={() => setShowBeta(true)}>{tr(locale, "Visa beta", "Show beta")}</button> : <><div className="beta-heading"><strong>{tr(locale, "Beta från originalföraren", "Beta from the original guide")}</strong><button type="button" onClick={() => setShowBeta(false)}>{tr(locale, "Dölj beta", "Hide beta")}</button></div><p><RichText text={routeBeta(selectedRoute) || ""} /></p>{locale === "en" && <MachineTranslationNote compact value={areaTranslation?.routes?.[selectedRoute.id]?.beta} original={selectedRoute.beta || ""} />}</>}
          </div>}
          {selectedRouteImages.length > 0 ? <div className="route-detail-images"><div><strong>{tr(locale, "Kopplad skiss", "Linked topo")}{selectedRoute.number && <em className="route-topo-number">{tr(locale, "Nr", "No.")} {selectedRoute.number} {tr(locale, "i skissen", "in topo")}</em>}</strong><span>{selectedRouteImages.some((image) => routeImageRelation(image, selectedRoute.id)?.method === "vision" && (routeImageRelation(image, selectedRoute.id)?.confidence || 0) >= 0.85) ? tr(locale, "Lednumret är avläst i originalskissen", "The route number was read from the original topo") : tr(locale, "Kopplad genom bildens placering vid ledlistan i originalet", "Linked by the image's position next to the route list in the original")} · {tr(locale, "tryck för full storlek", "tap for full size")}</span></div><div>{selectedRouteImages.slice(0, 4).map((image) => <button type="button" key={image.filename} onClick={() => openImageViewer(image)} aria-label={`${tr(locale, "Visa bild", "View image")}: ${selectedRouteTopoCaption(image)}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${encodeURIComponent(image.filename)}`} alt={selectedRouteTopoCaption(image)} /><span>{selectedRouteTopoCaption(image)}</span>
          </button>)}</div></div> : <p className="no-topo">{tr(locale, "Ingen skiss har ännu kunnat kopplas säkert till den här leden.", "No topo has yet been linked safely to this route.")}</p>}
          <div className="route-detail-sources"><strong>{tr(locale, "Källor för uppgifterna", "Sources for these facts")}</strong>{selectedRouteSources.map((sourceId) => { const source = area.provenance.sources.find((item) => item.id === sourceId); return source ? <a key={sourceId} href={source.url || `/api/source/${area.slug}`} target="_blank" rel="noreferrer">{source.title} ↗</a> : null; })}</div>
        </section>
      </div>}
    </>
  );
}

function SuggestionDialog({ area, locale, onClose }: { area: Area; locale: Locale; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const completed = status === "review";

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setPendingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);


  async function send(content: string) {
    if (!content.trim() || pending || completed) return;
    const next = [...conversation, { role: "user" as const, content: content.trim() }];
    setConversation(next);
    setMessage("");
    setStatus(null);
    setPendingSeconds(0);
    setPending(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ areaSlug: area.slug, conversation: next, locale }), signal: controller.signal });
      const result = await response.json();
      setStatus(result.status || "error");
      setConversation([...next, { role: "assistant", content: result.reply || result.error || tr(locale, "Förslaget kunde inte behandlas.", "The suggestion could not be processed.") }]);
    } catch (error) {
      setStatus("error");
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      setConversation([...next, { role: "assistant", content: timedOut ? tr(locale, "Granskningen tog för lång tid och avbröts. Förslaget kan ändå ha nått GitHub; försök inte skicka igen direkt.", "The review took too long and was stopped. The proposal may still have reached GitHub; do not submit it again immediately.") : tr(locale, "Tjänsten kunde inte nås. Försök igen om en stund.", "The service could not be reached. Please try again shortly.") }]);
    } finally { window.clearTimeout(timeout); setPending(false); }
  }

  function submit(event: React.FormEvent) { event.preventDefault(); void send(message); }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="suggest-title">
        <div className="modal-head"><div><span className="eyebrow" style={{ color: "var(--forest)" }}>{tr(locale, "Kunskapsbidrag", "Knowledge contribution")}</span><h2 id="suggest-title">{tr(locale, "Förbättra", "Improve")} {localized(area, locale, "name")}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={tr(locale, "Stäng", "Close")}>×</button></div>
        <p>{tr(locale, "Beskriv ändringen med egna ord. Agenten använder områdets befintliga innehåll som kontext och frågar bara när något avgörande saknas.", "Describe the change in your own words. The agent uses the area's existing content as context and only asks when essential information is missing.")}</p>
        <div className="conversation">{conversation.map((entry, index) => <div key={index} className={`bubble ${entry.role}`}>{entry.role === "assistant" ? <RichText text={entry.content} /> : entry.content}</div>)}</div>
        {pending && <div className="suggestion-progress" role="status" aria-live="polite"><strong>{tr(locale, "Agenterna arbetar", "Agents are working")}</strong><span>{pendingSeconds < 45 ? tr(locale, "Strukturerar och kvalitetsgranskar förslaget…", "Structuring and reviewing the proposal…") : tr(locale, "Skapar branch och inväntar GitHub Pull Request…", "Creating the branch and waiting for the GitHub Pull Request…")} · {pendingSeconds} s</span></div>}
        {status === "needs_information" && !pending && <div className="suggestion-shortcuts"><button type="button" onClick={() => void send(tr(locale, "Ja, gör så utifrån din sammanfattning.", "Yes, proceed based on your summary."))}>{tr(locale, "Ja, gör så", "Yes, proceed")}</button><button type="button" onClick={() => setMessage(tr(locale, "Jag vill förtydliga: ", "I want to clarify: "))}>{tr(locale, "Jag vill förtydliga", "I want to clarify")}</button></div>}
        <form className="suggestion-form" onSubmit={submit}>
          <textarea value={message} disabled={completed} onChange={(event) => setMessage(event.target.value)} placeholder={completed ? tr(locale, "Förslaget finns nu i GitHub-flödet.", "The proposal is now in the GitHub workflow.") : conversation.length ? tr(locale, "Svara kort eller lägg till en detalj…", "Reply briefly or add a detail…") : tr(locale, "Exempel: Ta bort stycket om tv-serien i den allmänna beskrivningen.", "Example: Remove the paragraph about the TV series from the general description.")} aria-label={tr(locale, "Ditt ändringsförslag", "Your edit suggestion")} />
          <div className="form-actions"><small>{tr(locale, "Redaktionella ändringar kan bygga på ditt godkännande. Nya fakta behöver en kontrollerbar källa. När du skickar bekräftar du att du får bidra med texten och godkänner att accepterat förarinnehåll publiceras under GFDL 1.3.", "Editorial changes may rely on your approval. New facts require a verifiable source. By submitting, you confirm that you may contribute the text and agree that accepted guide content is published under GFDL 1.3.")}</small><button className="primary-button" disabled={pending || completed || !message.trim()} type="submit">{pending ? tr(locale, "Granskar…", "Reviewing…") : completed ? tr(locale, "Klart", "Done") : conversation.length ? tr(locale, "Skicka svar", "Send reply") : tr(locale, "Skicka förslag", "Send suggestion")}</button></div>
        </form>
      </section>
    </div>
  );
}
