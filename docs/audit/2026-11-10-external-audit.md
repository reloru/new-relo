# External audit triage — 2026-11-10

An outside AI agent (Grok Bot, running on its own cloud VM) audited the live
site: Lighthouse mobile, TLS and headers, DNS mail records, and a 100-page
crawl. It reported nothing critical. This file records what was done with each
finding and why. The findings were checked against this repo before acting.

## Acted on

| Finding | Outcome |
|---|---|
| Hub water badge "None"/"All normal": white on `#1f8b4c` = 4.32:1, below AA | **Confirmed and widened.** The same failure was in every green status banner, the gauge and fishing badges, the AQI hero, and in the light end of most gradients (`#2eb86a` 2.57:1, amber `#e0a800` 2.15:1, orange `#e2621a` 3.50:1, gray `#7a8494` 3.78:1), plus the two blue heroes (`--accent` end, 4.34:1). The audit's one-line fix covered one selector. 35 stops recoloured, keeping each hue; `scripts/test-contrast.mjs` now measures every fill under white text and fails on any stop below 4.5:1. Found while sweeping: two pollen category colours below 3:1 on the dark-mode card, and the default badge gray (`var(--muted)`) turning light gray under white text in dark mode. Both fixed. |
| Meta description 186 characters | Trimmed to 147 (EN) and 155 (ES). |
| (Raised in follow-up) `/api/health` has no air row | **Confirmed, not by design.** AQI and UV are stored inside the `weather` entry and fail to `null` without failing it, so an outage was invisible. Added `air` and `uv` rows; see `docs/endpoints/api/health.md`. |

## Not acted on

| Finding | Why |
|---|---|
| Add HSTS `preload` and submit to hstspreload.org | Already decided against on 2026-11-09 (`docs/audit/2026-11-09-hsts-preload.md`). |
| CSP `'unsafe-inline'` cancels the script hashes | Wrong, and retracted by the auditor. Browsers that support hashes ignore `'unsafe-inline'` in `script-src`; it is a deliberate fallback (`src/discovery.js`). |
| Apple touch icon as a data URI; 512×512 `og:image` | Deliberate, documented in `CLAUDE.md` ("Shared head"). |
| SPF `~all` → `-all` | Optional with DMARC at `p=reject`; mail is iCloud-managed, left to the owner. |
| `/radar-image` is 850 KB | Not investigated in this pass. |
| TLS 1.0/1.1 refusal, HTTP/3 | The auditor could not check these from its network; not re-checked here. |
