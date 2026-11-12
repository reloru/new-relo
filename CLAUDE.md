# crosbynews.com

One Cloudflare Worker: a live production site for Crosby, Texas. Current
conditions and forecasts, plus a dated record of the town's weather, floods,
burn bans and school dates. Every page is served in English and Mexican
Spanish, beside a JSON API, an MCP server and RSS feeds. No framework and no
runtime dependencies: `fetch`, KV, D1 and static assets only.

## Checks

| | |
|---|---|
| Syntax | `find src -name '*.js' -print0 \| xargs -0 -n1 node --check` |
| One test | `node scripts/test-routes.mjs` (every `scripts/test-*.mjs` and `check-*.mjs` runs alone: pure Node, no install, no network) |
| All tests | `for f in scripts/check-*.mjs scripts/test-*.mjs; do node "$f" >/dev/null 2>&1 \|\| echo "FAIL $f"; done` (about a minute) |
| Build | `npm ci && npx wrangler deploy --dry-run` |
| Deploy | CI on push to `main`: D1 migrations, then the Worker. By hand: `/deploy` |
| Live | `/verify-site` after every deploy |

## Workflow

- One change per PR, verified live before the next. An audit's non-critical
  findings share one PR, two at most.
- Open and squash-merge the PR yourself. The two required checks are
  "Syntax check" and "Build check (dry-run)", and the branch must be up to
  date with `main`.
- A merge deletes the head branch. Start the next change with
  `git fetch origin main && git checkout -B <branch> origin/main`. A session
  cannot delete branches or change repo settings (403): don't retry.
- A new Worker version takes 1–2 minutes to reach every edge, and a
  cache-buster does not help. Sample a live check several times before
  calling it either way.
- Live checks send a bot User-Agent so they are not counted as visits:
  `Mozilla/5.0 (compatible; CrosbyNewsVerifyBot/1.0; +https://crosbynews.com/)`.
- Wrangler authenticates with `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`; `CLOUDFLARE_ZONE_API_TOKEN` is the wider
  zone-scoped token. Never `wrangler login`. A permission error after adding
  a binding means the token lacks it: say so, a session cannot widen it.
- The backlog is GitHub Issues labelled `backlog`; session task lists do not
  persist. In a run nobody is watching (the `@claude` workflow, a routine), a
  question prompt can go unanswered: write the decision out in text.

## Tests

- Mutation-test every new check: commit first, break the code, confirm the
  test fails, restore with `git checkout -- <file>`. Never restore from a
  copy, and never mutate uncommitted work. Read `git show --stat HEAD` before
  pushing a multi-file commit.
- A check that reuses the code under test cannot falsify it. Assert literal
  values written out by hand; to test a parser, extract from the upstream
  with a looser pattern and diff.
- Verify a new upstream from the deployed Worker before building on it: a
  temporary `/debug-<name>-canary` route, `npx wrangler deploy`, curl it
  live, then restore from git and redeploy. A curl from the container proves
  nothing (Google News answers containers and refuses Worker IPs).
- A new test must be added to `.github/workflows/deploy.yml` to run in CI.

## Where the rest is written down

`docs/pages/`, `docs/endpoints/` and `docs/ops/` record current expected
state, one file per page, route or topic. Overwrite the matching file in the
same PR as the change it describes, along with any rule below or
`.claude/skills/*/SKILL.md` the change makes stale. `docs/audit/` and
`docs/investigations/` are dated and never edited.

The invariants live in `.claude/rules/`. Each file loads when a matching file
is opened; read the one for your area first when planning, or in a session
where it has not loaded.

| Working on | Rule file |
|---|---|
| A page, a route, an endpoint, `/es` | `pages-and-routes.md` |
| What a page says or looks like: translation, timestamps, search signals, CSS | `content.md` |
| KV feeds, the D1 record, migrations, gauge and history pages | `data.md` |
| `src/assets/`, `public/`, icons | `assets.md` |
| The MCP server and its tool list | `mcp.md` |
| Request counting and `/privacy` | `privacy.md` |
| Workflows, `wrangler.jsonc`, dependencies | `ci.md` |

## Outside the repository's files

- Production KV: load `/kv` before any write or delete. Several keys must
  never be hand-edited, and `wrangler kv` reads local state without
  `--remote`.
- Production D1: `npx wrangler d1 execute crosby-record --remote --command "SELECT …"`.
- Cloudflare zone: HSTS is deliberately not preloaded (owner decision). Never
  paste a TXT record from a Cloudflare DCV email; re-read the certificate
  pack first. www → apex and http → https are one zone Redirect rule, not
  Worker code. Audit the edge with a browser User-Agent and an HTML `Accept`
  header: Cloudflare once injected a tracker a default curl never saw.
  `docs/ops/cloudflare-zone.md`, `docs/ops/domain.md`.
- DNS: `node scripts/dmarc.mjs` rewrites the DMARC record with one `rua` and
  would drop the second recipient Cloudflare added, so PATCH the live record
  for a policy change (`docs/ops/email-auth.md`). DNS-AID SVCB records:
  `node scripts/dns-aid.mjs` (`docs/ops/dns-aid.md`).
- Several GitHub repo toggles are dashboard-only for a session, and `gh`
  reaches REST but not GraphQL here. `docs/ops/github-security.md`.
