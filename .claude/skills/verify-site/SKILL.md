---
name: verify-site
description: Health-check the live crosbynews.com deploy with curl — key routes return 200, security headers present, canonical redirects are one hop, markdown negotiation works, unknown paths 404. Run after a deploy.
argument-hint: "[base-url]  (optional, defaults to https://crosbynews.com)"
allowed-tools: Bash(curl *)
---

# Verify the live site

Confirm the deployed site is healthy. Use the base URL in `$ARGUMENTS` if one was
given, otherwise `https://crosbynews.com`. Run the checks below with `curl`, then
report a compact PASS/FAIL table. For anything that FAILs, quote the actual
status/header so it's actionable. Deploys land in ~10–40s, so if a change is
missing, wait and re-run before calling it a failure.

## 1. Routes return 200
Each path should respond `200`:
`/`, `/weather`, `/hourly`, `/radar`, `/alerts`, `/water`, `/tropics`, `/pollen`, `/traffic`,
`/news`, `/calendar`, `/emergency`, `/about`, `/developers`,
`/privacy`, `/contact`, `/sitemap`, `/es` (Spanish spot-check),
`/robots.txt`, `/sitemap.xml`, `/llms.txt`,
`/api/weather`, `/api/health`, `/api/news`, `/api/calendar`, `/api/water`, `/api/tropics`, `/api/pollen`, `/api/traffic`,
`/alerts.xml`, `/news.xml`, `/badge.svg`,
`/manifest.json`, `/icon.svg`, `/sw.js`,
`/.well-known/api-catalog`, `/openapi.json`,
`/.well-known/security.txt`,
`/.well-known/mcp/server-card.json`,
`/.well-known/agent-skills/index.json`.

```bash
curl -s -o /dev/null -w "%{http_code}  %{url_effective}\n" "$BASE/<path>"
```

## 2. Security + negotiation headers on `/`
`curl -sI "$BASE/"` and confirm each header is present:
- `strict-transport-security`
- `x-frame-options`
- `content-security-policy`
- `x-content-type-options: nosniff`
- `referrer-policy`
- `permissions-policy`
- `vary: Accept`
- `link:` (advertises the markdown alternate, sitemap, api-catalog, openapi)

## 3. Canonicalization — ONE hop each
Without following redirects (`curl -sI`), each variant must `301` straight to the
apex `https://crosbynews.com/...` (query string preserved) in a single hop. Read
the `location:` header:
- `http://crosbynews.com/`      → `https://crosbynews.com/`
- `https://www.crosbynews.com/` → `https://crosbynews.com/`
- `http://www.crosbynews.com/`  → `https://crosbynews.com/`  (still one hop)

`https://crosbynews.com/` itself must NOT redirect (expect `200`).

## 4. Markdown content-negotiation
`/` should return markdown (not HTML) when asked two ways:
- `curl -s "$BASE/?format=md" | head`
- `curl -s -H "Accept: text/markdown" "$BASE/" | head`

## 5. Unknown path 404s
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/this-path-does-not-exist"   # expect 404
```

When everything passes, say so plainly. Otherwise list only the failures with the
observed value next to the expected one.
