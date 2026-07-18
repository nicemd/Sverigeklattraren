# Sverigeklättraren

Sverigeklättraren is a modern, open, and source-traceable climbing guide—and a practical experiment in how an LLM-powered wiki can revive knowledge that would otherwise be lost. It is a fork of Sverigeföraren: the new product and site are named Sverigeklättraren, while Sverigeföraren remains the name of the original guide and the preserved source archive.

Sverigeföraren.se was founded in 2006 by Niclas Emdelius and Per Lindh, sold in 2013, and subsequently fell into disrepair. Sverigeklättraren is built on the openly licensed snapshot preserved in 2014.

The new application is located in `web/`. The original MediaWiki files and images remain unchanged in `mediawiki/` and `images/`. The importer creates structured area documents in `content/` while preserving a direct reference to the primary source for every route and problem.

## OpenAI Build Week: how Codex and GPT-5.6 were used

Codex was the end-to-end development collaborator for Sverigeklättraren. It helped analyze the legacy MediaWiki archive, design the source-provenance model, implement the importer and agent workflows, build the responsive Next.js interface, write and run tests, diagnose failures, and validate production builds. Codex also helped create and verify the Docker-based deployment workflow, prepare the demo-video manuscript, and shape the Build Week submission. It supported the full path from a dormant archive and an initial idea to a deployed, documented product.

GPT-5.6 is also part of the running application through the OpenAI Responses API. It powers three evidence-bound editorial roles:

- **Import agent:** identifies route lists in loosely structured source material and proposes structured records with explicit evidence and confidence.
- **Editor agent:** converts a climber's free-text contribution into a precise, source-backed change proposal and asks follow-up questions when required information is missing.
- **Quality agent:** independently checks provenance, contradictions, uncertainty, and presentation before a proposal can be published.
- **Translation agent:** produces context-aware English descriptions from the complete area, sector, discipline, and neighbouring-route context while keeping route names, grades, and factual details unchanged.

GPT-5.6 vision is used to read route numbers and other markers from historical topos and propose connections to the corresponding structured routes. Each proposed relationship records its method, evidence, and confidence, and uncertain matches are not presented as facts.

The key product decision was to use AI for interpretation, never as factual authority. Every factual addition must point to a real source. Access restrictions, closures, parking, directions, coordinates, and safety information are protected changes that always require authoritative evidence and human review. Git records accepted changes as reviewable diffs and commits, giving the agent-driven wiki a durable audit trail.

## An agent-driven wiki

Codex was used to build, test, and iterate on the product. The OpenAI API and GPT-5.6 power three distinct editorial roles:

- **The import agent** structures MediaWiki templates and loose text, and uses vision to interpret route numbers in topos.
- **The quality agent** reviews formatting, sources, contradictions, and uncertain relationships using explicit evidence and confidence.
- **The editor agent** transforms users' free-text input into precise, source-backed change proposals and asks follow-up questions when the available information is insufficient.

Git is the wiki's memory: every publishable change is a diff and a commit. The model may propose structure and relationships, but it is never itself a factual source. The goal is a general architecture for abandoned knowledge bases, demonstrated through a demanding real-world case where users must be able to find the correct crag, sector, topo, and route.

## Features

- 803 searchable climbing areas and 14,830 imported routes and problems.
- A responsive React/Next.js interface with maps, directions, sectors, images, topos, and interactive route cards.
- Search by area, route, and grade, with filters for sectors, climbing routes, and boulder problems.
- Route cards with number, grade, length, first ascent, visible route description, and sources. A separate beta field is revealed only after an explicit user action.
- Traceable relationships between sectors, routes, and topos. A relationship can be derived from source order, filenames, or visual interpretation of route numbers, and records its method, evidence, and confidence.
- Live integration with the Swedish Climbing Federation's access database, showing both the source's update time and the local fetch time.
- Free-text proposals processed by separate structuring, presentation, and review agents through the OpenAI Responses API.
- A quality gate where access, parking, directions, coordinates, closures, and safety information always require human review.
- Every accepted contribution is a GitHub Pull Request. Human-review proposals remain unpublished until merge; low-risk, fully cited proposals may merge automatically only after policy checks, deterministic import, tests, and a production build pass.
- Sources are registered per changed route field. Fact-reference sources, such as 27crags, may support short factual claims but never republished text, images, or topos.

## Data and database

The project's published knowledge base consists of version-controlled JSON documents in `content/areas/`. There is no separate SQL database in production: Git provides history and the review trail, while the JSON documents are the buildable and publishable representation. `content/areas.json` is the searchable area index.

Each area document broadly follows this model:

```text
area
├── sectors and editorial text blocks
├── routes and problems
│   ├── sector relationship
│   ├── source for the original record
│   └── zero, one, or multiple sources per factual field
├── images and topos
│   └── route relationships with method, confidence, and evidence
├── external links
├── access relationship
└── provenance and quality notes
```

`mediawiki/` and `images/` contain the immutable 2014 snapshot. The importer may improve the structure but never rewrites the original. Generated documents can be rebuilt reproducibly, with later committed proposals replayed during the process.

## Topos and route relationships

A topo may belong to a sector while also being linked to multiple routes. The importer uses general, reviewable signals:

- `source-order`: the image and route list follow each other within the same original section.
- `filename`: the route's identity is apparent from the image filename.
- `vision`: OpenAI reads route numbers or other clear markers in the topo and matches them to the structured route list.

Each relationship stores its method, confidence, and a short piece of evidence. Uncertain relationships are not presented as certain; instead, the route card states that no topo has yet been reliably linked. The inputs and outputs of LLM enrichment are stored in `content/enrichment/`, allowing the results to be reviewed and rebuilt without another model call.

Run visual interpretation for a specific area, or explicitly for all areas:

```powershell
cd web
npm run content:topos -- --area haggsta
npm run content:topos -- --all
```

## Multiple sources and rights

`provenance.sources` contains the area's source registry. Every route has a primary source and may also have `fieldSources` for fields such as name, grade, length, first ascent, route description, beta, or sector. The same factual claim can therefore be supported by multiple sources, while different fields on the same route may have different origins. The route description explains where and how the line runs on the rock and is displayed directly; beta describes holds, moves, or the solution and remains hidden until the user chooses to reveal it.

A source specifies how it may be used:

- `licensed-content`: the license permits the material to be republished with attribution.
- `fact-reference`: the source supports individual facts; its text, images, and topos are not copied.
- `firsthand`: a user proposal or other firsthand report with its own traceability.

This makes it possible, for example, to supplement a route name from an external service without republishing that service's description or images. Source references are shown both for the area and on the affected route card.

## LLM-driven import and change proposals

OpenAI is used for tasks where the old wiki's templates and prose are insufficient for deterministic import:

- `npm run content:loose-routes -- --area <slug>` identifies route lists in loose content and proposes structured routes with explicit evidence and confidence.
- `npm run content:topos -- --area <slug>` interprets topos and proposes relationships to existing route numbers.
- `npm run content:translate -- -- --area <slug>` creates context-aware English descriptions and beta, clearly marked as machine translated in the reader. Translation defaults to the cost-efficient `gpt-4o-mini`; set `OPENAI_TRANSLATION_MODEL` to make an intentional model override. Use `npm run content:translate -- -- --all --concurrency 3` only when intentionally refreshing the complete archive. The batch is resumable and field-aware: every completed area is atomically checkpointed in Git data, incomplete structured responses are retried, existing valid fields are reused, temporary API errors are retried, failures are recorded separately, and a depleted API quota stops the run early instead of producing hundreds of retries.
- Free-text proposals submitted through the site are processed by separate roles for fact collection, presentation, and independent quality review.

Translations are an import enrichment rather than an opaque runtime rewrite. Results are cached in `content/enrichment/translations-en.json`, carry their model and source references, and are committed for review. A hash of the Swedish area, sectors, routes, descriptions, and beta invalidates stale translations after source changes; the MediaWiki importer reapplies only cache entries matching the current source context. This keeps repeated imports deterministic and avoids translating route descriptions without knowing whether a term refers to a hold, a feature, an orientation, or a place. Route descriptions remain visible, while translated beta remains behind the same explicit reveal control as Swedish beta.

`npm run content:translations:validate` verifies the entire committed translation corpus: every area and source hash, every translated area and sector description, every translated route description and beta field, the attached area files, the manifest, source references, and the absence of unresolved batch failures. Run it before committing or deploying a batch.

When an English reader opens an area that has not yet been imported into the Git cache, the application provides a context-aware runtime fallback. The area and its section descriptions are translated together; individual route descriptions and beta are translated when their field card is opened, using the sector and neighbouring routes as context. Runtime results are deduplicated in the running server, clearly marked as machine translated, and never replace the Swedish source. The public endpoint is rate-limited. Frequently used translations should still be promoted through `content:translate` so they become reviewable, reproducible Git data.

LLM output is never itself a factual source. It must point back to source material, be stored as reviewable enrichment data, and pass the project's quality gate. Agent proposals are pushed to isolated `proposal/*` branches and opened as GitHub Pull Requests. Merging is the durable approval event; access, parking, closures, coordinates, and other safety-critical information always require a human merge.

## Local development

```powershell
cd web
npm ci
npm run content:import
npm run dev
```

Configuration is documented in `.env.example`. Store secrets in the Git-ignored `.env.local` file at the repository root; the Next.js configuration reads the same file during local development, and the deployment script reuses it without committing the key. The default editorial model is the cost-efficient `gpt-5-mini`; it can be overridden intentionally through `OPENAI_EDITORIAL_MODEL`.

## Verification

```powershell
cd web
npm test
npm run build
```

`npm run build` uses the version-controlled `content/` representation. `npm run content:import` is required when the importer or the 2014 sources change; it then replays automatically published proposals so that later knowledge is not lost.

## Private deployment on davtor1

GitHub is the canonical deployment source. A merge to `main` runs `.github/workflows/deploy.yml`, builds an immutable SHA-tagged GHCR image, connects with a dedicated davtor1 deployment key, fast-forwards the clean server checkout, recreates the container, and verifies the localhost health endpoint. The application remains bound to `127.0.0.1` and exposed through host Tailscale. The workflow deliberately refuses to overwrite dirty files or unpushed server commits. `deploy.ps1` remains the explicitly confirmed manual recovery path.

If davtor1 has the `services/sverigeklattraren` capability, the dedicated address `https://sverigeklattraren.tail026a3a.ts.net/` is used. Otherwise, the script automatically uses the private MagicDNS fallback address `https://davtor1.tail026a3a.ts.net:8443/` without affecting the host's existing HTTPS services on port 443. `-Confirmed` may only be used when the user has already explicitly approved the deployment in the active session.

For a deliberately public demo, run `./deploy.ps1 -Public` after confirming that the public OpenAI-backed contribution endpoint and its rate limits are appropriate. Once Funnel is enabled, later deploys detect and preserve it instead of silently reverting the site to tailnet-only access. Disable the public proxy with `sudo tailscale funnel --https=8443 off` on davtor1.

## License

This repository uses a split licence model:

- **Guide content stays free:** the preserved MediaWiki archive, publishable guide data, descriptions, route text, committed translations, and licensed archive media are distributed under the GNU Free Documentation License 1.3. See [CONTENT_LICENSE.md](CONTENT_LICENSE.md) and the [unaltered GFDL text](LICENSE-CONTENT-GFDL-1.3.txt).
- **The website is proprietary:** application code, UI and visual design, schemas, import and agent tooling, deployment configuration, and original software assets are all rights reserved. See [LICENSE](LICENSE).
- **External sources keep their own terms:** every external source must retain its attribution and licence metadata. A factual reference never grants permission to copy its wording, images, or topos.

Accepted guide contributions are published under GFDL 1.3. Source availability for the website software does not grant permission to reuse, modify, redistribute, or host it.
