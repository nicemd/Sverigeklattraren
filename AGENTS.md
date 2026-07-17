# Sverigeföraren development guide

## Canonical data

- `mediawiki/` and `images/` are the immutable 2014 primary-source snapshot.
- `content/areas/*.json` is the current publishable representation.
- Run `npm run content:import` from `web/` after importer or legacy-source changes. The importer replays committed auto-published proposals; never silently rewrite the legacy snapshot.
- Every factual addition must carry a source in `provenance.sources`.

## Safety and access

- Access restrictions, parking rules, closures and safety information are protected changes.
- Protected changes always require human review and must cite an authoritative source.
- Show both the source's own update time and the local fetch time.
- Never use an LLM-generated statement as a factual source.

## Verification

From `web/`, run:

1. `npm run content:import`
2. `npm test`
3. `npm run build`

Review responsive behavior at desktop and narrow mobile widths for user-facing changes.
