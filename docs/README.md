# docs/

Four directories, two kinds of document. The distinction is the whole point:
**state files get overwritten, dated files never do.**

## `pages/` — current expected state, one file per public page

One file per content page, mirroring the URL path. Records what the page renders
now: content blocks and the data feeding each, canonical URL, sitemap presence,
meta and CSP expectations, and a Locale section.

**No history.** A state change overwrites the file. What a page used to look like
is what git history and the PR that changed it are for.

`/es` is not a second page set, so there are no Spanish files. `lang` is a
parameter threaded through the render functions and the `/es` prefix is stripped
before dispatch to the same handler — so locale is a section inside each page's
file, not a parallel tree.

## `endpoints/` — current expected state, one file per non-page route

The parallel tree for everything that is not a content page: `/api/*`, the MCP
JSON-RPC transport, `/openapi.json`, `/.well-known/*`, `/robots.txt`,
`/llms.txt`, `/sitemap.xml`, the RSS feeds, `/sw.js`, `/manifest.json`, the
icons, `/badge.svg`, and the two image proxies. Same no-history rule.

These document *behavior* — methods, request and response shape, status codes,
data source, caching, conditional-GET seed, CORS — rather than page content.

A single URL appears in both trees when it exposes different interfaces by
method. `/mcp` does: `GET /mcp` is a human explainer page (`pages/mcp.md`),
`POST /mcp` is the JSON-RPC transport (`endpoints/mcp.md`).

## `audit/` — dated, never edited in place

Point-in-time audits, `YYYY-MM-DD-<topic>.md`. An audit describes the codebase as
it was on its date. Superseding one means writing a new one.

## `investigations/` — dated, never edited in place

Investigation logs, `YYYY-MM-DD-<slug>.md`: why a decision was made, what was
measured, what was ruled out. Same rule as audits.

## Where the change record lives

Git history and PR bodies. There is deliberately no `CHANGELOG.md`: the repo
squash-merges one change per PR with a Summary / Changes / Verification body, so
a changelog would be a second source of truth with nothing forcing it current —
the exact drift this directory exists to stop.

## Keeping these files true

A PR that changes a page's handler, content, data source, canonical URL, sitemap
presence, meta, or CSP expectations updates that page's file **in the same PR**.
Same rule for non-page routes and `endpoints/`. See CLAUDE.md, "Working with
this repo."

## Not deployed

Nothing here reaches production. `wrangler.jsonc` declares no `assets`, no
`site`, and no `rules` block, so the only artifact uploaded is the esbuild bundle
rooted at `main` (`src/index.js`), and no file under `docs/` is reachable by
import from it. There is nothing to exclude — the path is already outside every
upload surface.
