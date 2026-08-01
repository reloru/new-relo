---
name: deploy
description: Deploy the crosbynews Worker to Cloudflare and verify it's live. Syntax-checks every file under src/, surfaces branch/working-tree state, runs `npx wrangler deploy`, then curls the live site. Use when asked to deploy, ship, or push the Worker live.
argument-hint: "(no args; pass --dry-run to build without uploading)"
allowed-tools: Bash(node --check *), Bash(git status *), Bash(git branch *), Bash(npx wrangler deploy *), Bash(curl *)
---

# Deploy the Worker

Ship the Worker source under `src/` to the `crosbynews` Worker and confirm the
live site is healthy. Auth comes from `CLOUDFLARE_ZONE_API_TOKEN` (preferred — see
CLAUDE.md's Deploy section) or `CLOUDFLARE_API_TOKEN`, paired with
`CLOUDFLARE_ACCOUNT_ID` either way (never a zone id — wrangler has no such
concept) — **never run `wrangler login`** (it clobbers the token auth).

If `$ARGUMENTS` contains `--dry-run`, run step 1, then the dry-run in step 3, and
stop — nothing is uploaded and nothing goes live.

## 1. Pre-flight — syntax gate
Mirror CI's gate before shipping. If this fails, STOP — do not deploy. It covers
every file under `src/`, not just the entry point: `node --check` validates one
file at a time and doesn't follow imports, so checking only `src/index.js` would
pass while an imported module was unparseable.
```bash
find src -name '*.js' -print0 | xargs -0 -n1 node --check
```
Then the cross-module reference check and the renderer sweep (both pure node,
no install):
```bash
node scripts/check-module-refs.mjs
node scripts/check-renders.mjs
```
`node --check` catches syntax errors but NOT a missing or renamed export — the
dry-run in step 3 catches that, so treat it as a merge gate, not an optional
extra. And NEITHER catches a module using another module's export without
importing it, because esbuild treats an unresolved identifier as a global. That
is what `check-module-refs.mjs` is for; run all three.

## 2. Pre-flight — know what you're shipping
`npx wrangler deploy` uploads the **current working tree**, not git. Deploying
from a feature branch pushes that code straight to production, bypassing the
PR + `Syntax check` gate. Check first:
```bash
git branch --show-current
git status --short
```
- Not on a clean `main`? Say so and confirm the intent is a direct prod push
  from this working tree before continuing.
- The canonical path is merge-to-`main` → CI deploys. A manual deploy is for
  out-of-band / urgent ships.

## 3. Deploy
```bash
npx wrangler deploy
```
Build-only check that uploads nothing (safe to run anytime):
```bash
npx wrangler deploy --dry-run
```
Note the **Version ID** and deployed URL from the output. (wrangler may also
print a one-line "Cloudflare agent skills are available" banner — cosmetic;
`CI=1 npx wrangler deploy` silences it.)

## 4. Verify (deploys land in ~10–40s)
Wait a few seconds, then confirm the live site — run the `/verify-site` checks,
or at minimum re-fetch the homepage and any route you touched:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://crosbynews.com/
```
Use `-o /dev/null -w`, not `curl -sI`: the proxy prepends an `HTTP/1.1 200
Connection Established` CONNECT line, so the first `HTTP/...` line isn't the
response's and a `301` misreads as `200` (see `/verify-site`).
If a change looks missing right after deploy, wait and re-check before calling it
a failure — propagation isn't instant.

## Troubleshooting
- **Auth/permission error right after adding a new binding** (D1, Queues,
  Vectorize, KV, …) even with `CLOUDFLARE_ZONE_API_TOKEN`: a genuinely missing
  permission on that token. Widening it needs the Cloudflare dashboard, which
  a session can't do itself — say so rather than retrying blind.
- **"Missing entry-point" / can't parse `wrangler.jsonc`**: that's wrangler 3.x.
  Locally the pinned `wrangler@^4` devDependency avoids it; in CI it's the
  `wranglerVersion: "4"` setting.
- **Never** run `wrangler login`.
