# Sverigeföraren

En modern, öppen och källspårbar klätterförare byggd på innehållet från `sverigeforaren.se` såsom det bevarades 2014.

Den nya applikationen finns i `web/`. Originalets MediaWiki-filer och bilder ligger kvar oförändrade i `mediawiki/` respektive `images/`. Importverktyget skapar strukturerade områdesdokument i `content/` och bevarar en direkt hänvisning till primärkällan för varje led och problem.

## Funktioner

- 803 sökbara klätterområden och 14 824 importerade leder/problem.
- Responsiv React/Next.js-vy med karta, bilder, topos och leddata.
- Livekoppling till Svenska Klätterförbundets accessdatabas med källans uppdateringsdatum och lokal hämtningstid.
- Fritextförslag som bearbetas av separata struktur-, presentations- och granskningsagenter via OpenAI Responses API.
- Kvalitetsgrind där access- och säkerhetsuppgifter alltid kräver mänsklig granskning.
- Godkända ändringar och granskningsärenden sparas genom Git-commits.

## Lokal utveckling

```powershell
cd web
npm ci
npm run content:import
npm run dev
```

Konfigurationen dokumenteras i `.env.example`. Lägg hemligheter i den Git-ignorerade `.env.local` i repots rot.

## Verifiering

```powershell
cd web
npm test
npm run build
```

`npm run build` använder den versionsstyrda `content/`-representationen. `npm run content:import` behövs när importeraren eller 2014-källorna ändras och återspelar då auto-publicerade förslag så att senare kunskap inte går förlorad.

## Privat drift på davtor1

`Dockerfile`, `docker-compose.yml` och `deploy.ps1` bygger en GHCR-image, håller applikationsporten bunden till `127.0.0.1` och exponerar den privat med värdens Tailscale Service. Deployskriptet kräver alltid en uttrycklig `DEPLOY`-bekräftelse innan externa eller fjärrstyrda ändringar.

## Licens

Originalinnehållet distribueras under GNU Free Documentation License. Se [LICENSE](LICENSE). Nya externa källor ska registreras med egen attribution och licensmetadata; en extern källa görs aldrig automatiskt till projektets egen text.
