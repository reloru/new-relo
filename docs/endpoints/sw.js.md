# `GET /sw.js`

The service worker. Offline resilience for storm time, when Crosby's connectivity
is at its flakiest exactly when the site matters most.

| | |
|---|---|
| **Source** | the `SW_SCRIPT` constant (`src/assets/sw-script.js`), served **byte-for-byte** |
| **Content-type** | `text/javascript; charset=utf-8` |
| **Cache** | `no-cache` — so a deploy is picked up on the next visit rather than after a stale-cache window |
| **Registered from** | `HOME_SCRIPT`, so the registration's CSP hash recomputes automatically |

## Cache version

`CACHE = "crosby-v3"`. **Bump it when changing this script's behavior** — the
`activate` handler sweeps every cache whose name is not the current one. Bumped
from `crosby-v2` on 2026-08-19 with the revalidation change below, which also
swept the manifest/favicon copies that had been frozen since install.

`PRECACHE`: `/`, `/alerts`, `/es`, `/es/alerts`, `/manifest.json`,
`/favicon.svg` — the storm-critical set.

## Strategy

- **Navigations:** network-first, so pages are always fresh online. A successful
  query-less response is cached as it goes (query-ful URLs are skipped so
  variants cannot bloat the cache). Offline, it falls back to the cached copy, or
  to the language hub (`/es` for `/es/*`, else `/`).
- **Precached assets:** **stale-while-revalidate** — the cached copy is served
  immediately (still instant, still offline-proof) and a background fetch
  refreshes it for next time. Never revert this to plain cache-first. Navigations
  return from the branch above and never reach here, so the only paths this
  actually serves are `/manifest.json` and `/favicon.svg` — and cache-first has
  no expiry, so an installed PWA kept the manifest it downloaded at install
  forever (wrong name, icons, theme colour or `start_url`), with a `CACHE` bump
  the only escape. Silent, and invisible on a fresh device because only
  already-installed clients are affected. `scripts/test-sw-revalidate.mjs` is the
  regression gate; it reports `v1,v1,v1` against the old cache-first code.
- Non-GET and cross-origin requests are ignored.

## The `ignoreVary` gotcha

Every `caches.match` call passes `{ ignoreVary: true }`, and **must**. The content
pages send `Vary: Accept`, the Cache API respects Vary, and a navigation's
`Accept` header never equals the precache fetch's `*/*` — so without it every
offline match misses and collapses to the hub. This was caught in testing, not in
production.

## Push

Carries the `push` and `notificationclick` handlers. The Worker sends a
**payload-less** VAPID wake-up, so this script composes the notification itself:
it fetches `/api/weather` with `cache: "no-store"`, filters against its own
`PUSH_EVENTS` list, and shows one notification per active severe warning.
`userVisibleOnly` requires *something* be shown, so the expired-by-now race and
the fetch-failure path both fall back to a generic prompt rather than a silent —
and penalized — push.

`PUSH_EVENTS` here is **kept in sync by hand with `SEVERE_PUSH_EVENTS` in the
Worker.** Changing one means changing both.

`notificationclick` focuses an existing `/alerts` window or opens one.

## Escaping

The script contains `\\uXXXX` and `\\n` sequences that are literal in the
template literal and become real escape sequences in the shipped JS. Reformatting
or "cleaning up" those escapes silently ships broken client code, and
`node --check` cannot see it — the whole thing is a string as far as the Worker
is concerned.

## Verification

`scripts/test-sw-offline.mjs` boots `wrangler dev`, registers and precaches, then
**kills the server** and re-navigates against a persistent profile, asserting
cached pages serve themselves and uncached paths fall back to the language hub.

It has to kill the server because Playwright's `setOffline` does **not** apply to
SW-initiated fetches. Run it after any change here rather than re-deriving the
procedure.

## CSP

`worker-src` is not set, so service-worker loading falls back to
`script-src 'self'`, which passes.
