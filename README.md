# Sverigeföraren

En modern, öppen och källspårbar klätterförare byggd på innehållet från `sverigeforaren.se` såsom det bevarades 2014.

Den nya applikationen finns i `web/`. Originalets MediaWiki-filer och bilder ligger kvar oförändrade i `mediawiki/` respektive `images/`. Importverktyget skapar strukturerade områdesdokument i `content/` och bevarar en direkt hänvisning till primärkällan för varje led och problem.

## Funktioner

- 803 sökbara klätterområden och 14 830 importerade leder/problem.
- Responsiv React/Next.js-vy med karta, vägbeskrivning, sektorer, bilder, topos och klickbara ledkort.
- Sökning på område, led och grad samt filtrering mellan sektorer, klätterleder och boulderproblem.
- Ledkort med nummer, grad, längd, förstebestigning, beskrivning och källor. Beta visas först efter ett aktivt val.
- Spårbara relationer mellan sektor, led och skiss. Kopplingen kan härledas från källordning, filnamn eller bildtolkning av lednummer och har metod, belägg och konfidens.
- Livekoppling till Svenska Klätterförbundets accessdatabas med källans uppdateringsdatum och lokal hämtningstid.
- Fritextförslag som bearbetas av separata struktur-, presentations- och granskningsagenter via OpenAI Responses API.
- Kvalitetsgrind där access, parkering, vägbeskrivning, koordinater, avstängningar och säkerhetsuppgifter alltid kräver mänsklig granskning.
- Godkända ändringar och granskningsärenden sparas genom Git-commits.
- Källor registreras per ändrat ledfält. Faktareferenser, exempelvis 27crags, får belägga korta fakta men aldrig återpublicerad text, bild eller topo.

## Data och databas

Projektets publicerade kunskapsdatabas är versionsstyrda JSON-dokument i `content/areas/`. Det finns ingen separat SQL-databas i drift: Git är historik och granskningsspår, medan JSON-dokumenten är den byggbara och publicerbara representationen. `content/areas.json` är det sökbara områdesindexet.

Varje områdesdokument följer i huvudsak denna modell:

```text
område
├── sektorer och redaktionella textblock
├── leder och problem
│   ├── sektorrelation
│   ├── källa för originalposten
│   └── noll, en eller flera källor per faktfält
├── bilder och topos
│   └── ledrelationer med metod, konfidens och belägg
├── externa länkar
├── accesskoppling
└── provenance och kvalitetsanmärkningar
```

`mediawiki/` och `images/` är den oföränderliga ögonblicksbilden från 2014. Importen får förbättra strukturen men skriver aldrig om originalet. Genererade dokument kan byggas om reproducerbart och senare, committade förslag spelas då tillbaka.

## Skisser och ledrelationer

En topo kan höra till en sektor och samtidigt vara kopplad till flera leder. Importören använder generella, granskningsbara signaler:

- `source-order`: bilden och ledlistan följer varandra i samma originalsektion.
- `filename`: ledens identitet framgår av bildens filnamn.
- `vision`: OpenAI läser lednummer eller andra tydliga markörer i skissen och matchar dem mot den strukturerade ledlistan.

Varje relation lagrar metod, konfidens och ett kort belägg. Osäkra relationer visas inte som säkra; ledkortet säger i stället att ingen skiss ännu har kunnat kopplas. Underlaget för LLM-berikning sparas i `content/enrichment/`, så resultatet kan granskas och byggas om utan ett nytt modell-anrop.

Kör bildtolkningen för ett avgränsat område eller uttryckligen för alla områden:

```powershell
cd web
npm run content:topos -- --area haggsta
npm run content:topos -- --all
```

## Flera källor och rättigheter

`provenance.sources` innehåller områdets källregister. Varje led har en primärkälla och kan dessutom ha `fieldSources` för exempelvis namn, grad, längd, förstebestigning eller sektor. Samma faktauppgift kan därmed beläggas av flera källor och olika fält på samma led kan ha olika ursprung.

En källa anger hur den får användas:

- `licensed-content`: licensen tillåter att materialet återpubliceras med angiven attribution.
- `fact-reference`: källan belägger enstaka fakta; text, bilder och topos kopieras inte.
- `firsthand`: ett användarförslag eller annan förstahandsuppgift med egen spårbarhet.

Det gör det möjligt att exempelvis komplettera ett lednamn från en extern tjänst utan att återpublicera tjänstens beskrivning eller bilder. Källhänvisningar visas både för området och på det berörda ledkortet.

## LLM-driven import och ändringsförslag

OpenAI används för uppgifter där den gamla wikins mallar och löptext inte räcker för deterministisk import:

- `npm run content:loose-routes -- --area <slug>` identifierar ledlistor i löst innehåll och föreslår strukturerade leder med explicit belägg och konfidens.
- `npm run content:topos -- --area <slug>` tolkar skisser och föreslår relationer till befintliga lednummer.
- Fritextförslag i sajten hanteras av separata roller för faktainsamling, presentation och oberoende kvalitetsgranskning.

LLM-resultat är aldrig i sig en faktakälla. De måste peka tillbaka på källmaterialet, lagras som granskningsbart berikningsunderlag och passera projektets kvalitetsgrind. Godkända ändringar blir Git-commits; access, parkering, avstängningar, koordinater och annan säkerhetskritisk information kräver mänsklig granskning.

## Lokal utveckling

```powershell
cd web
npm ci
npm run content:import
npm run dev
```

Konfigurationen dokumenteras i `.env.example`. Lägg hemligheter i den Git-ignorerade `.env.local` i repots rot; Next-konfigurationen läser samma fil vid lokal utveckling och deployskriptet återanvänder den utan att checka in nyckeln. Standardmodellen är den explicita kvalitetsrollen `gpt-5.6-sol`.

## Verifiering

```powershell
cd web
npm test
npm run build
```

`npm run build` använder den versionsstyrda `content/`-representationen. `npm run content:import` behövs när importeraren eller 2014-källorna ändras och återspelar då auto-publicerade förslag så att senare kunskap inte går förlorad.

## Privat drift på davtor1

`Dockerfile`, `docker-compose.yml` och `deploy.ps1` bygger en Git-versionsmärkt GHCR-image, håller applikationsporten bunden till `127.0.0.1` och exponerar den privat med värdens Tailscale Service. Deployskriptet kräver en ren `codex/wiki-2026`, kontrollerar servicekapabiliteten före push, kräver alltid en uttrycklig `DEPLOY`-bekräftelse, väntar in hälsa och återställer föregående compose-konfiguration om fjärrverifieringen misslyckas.

Om davtor1 har kapabiliteten `services/sverigeforaren` används den egna adressen `https://sverigeforaren.tail026a3a.ts.net/`. Annars använder skriptet automatiskt den privata MagicDNS-reservadressen `https://davtor1.tail026a3a.ts.net:8443/`, utan att påverka värdens befintliga HTTPS-tjänster på port 443. `-Confirmed` får bara användas när användaren redan har godkänt deploy uttryckligen i den aktiva sessionen.

## Licens

Originalinnehållet distribueras under GNU Free Documentation License. Se [LICENSE](LICENSE). Nya externa källor ska registreras med egen attribution och licensmetadata; en extern källa görs aldrig automatiskt till projektets egen text.
