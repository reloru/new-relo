---
name: deploy
description: Deploy the crosbynews Worker to Cloudflare and verify it's live. Syntax-checks src/index.js, surfaces branch/working-tree state, runs `npx wrangler deploy`, then curls the live site. Use when asked to deploy, ship, or push the Worker live.
argument-hint: "(no args; pass --dry-run to build without uploading)"
allowed-tools: Bash(node --check *), Bash(git status *), Bash(git branch *), Bash(npx wrangler deploy *), Bash(curl *)
---

# Deploy the Worker

Ship `src/index.js` to the `crosbynews` Worker and confirm the live site is
healthy. Auth comes from `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the
environment — **never run `wrangler login`** (it clobbers the token auth).

If `$ARGUMENTS` contains `--dry-run`, run step 1, then the dry-run in step 3, and
stop — nothing is uploaded and nothing goes live.

## 1. Pre-flight — syntax gate
Mirror CI's gate before shipping. If this fails, STOP — do not deploy.
```bash
node --check src/index.js
```

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
curl -sI https://crosbynews.com/ | head
```
If a change looks missing right after deploy, wait and re-check before calling it
a failure — propagation isn't instant.

## Troubleshooting
- **Auth/permission error right after adding a new binding** (D1, Queues,
  Vectorize, KV, …): almost always the API token missing that permission —
  widen it in the Cloudflare dashboard, not a code bug.
- **"Missing entry-point" / can't parse `wrangler.jsonc`**: that's wrangler 3.x.
  Locally the pinned `wrangler@^4` devDependency avoids it; in CI it's the
  `wranglerVersion: "4"` setting.
- **Never** run `wrangler login`.
