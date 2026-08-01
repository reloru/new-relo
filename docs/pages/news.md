# `/news` — local news

Local headlines for Crosby and nearby towns. **The Worker is a pure renderer
here** — it only reads the `news` KV key, which is written out-of-band.

| | |
|---|---|
| **Handlers** | `newsHtml(data, lang, admin)` / `newsMarkdown(data, lang)` — `src/index.js` |
| **Route** | `_fetch` → `page === "/news"` |
| **Spanish** | `/es/news` |
| **Cache** | `public, max-age=900` — or `private, no-store` in the admin view |
| **Negotiation** | `Accept: text/markdown` or `?format=md`; `Vary: Accept` |

## Content blocks

| Block | Source |
|---|---|
| Article list (`newsList`) — title, source, date, category (community / incident) | `news` KV, blocklist-filtered |
| RSS discovery link | `/news.xml` |
| Attribution + no-full-text note | static |

## Data

`loadNews(env)` reads the `news` key and the worker-owned `news_blocklist` key in
parallel, and filters blocked links out.

**The `news` key is routine-owned, not cron-owned.** Google News RSS is the only
source with real Crosby coverage, and it hard-blocks Cloudflare Worker
datacenter IPs (503). So `scripts/fetch-news.mjs` runs on a Claude routine — whose
environment is not IP-blocked — queries Google News, filters, and writes the key
via the Cloudflare KV API. All the relevance and de-duplication logic lives in
that script, not in the Worker.

If the routine stops, items age out at 45 days and the page shows an honest "no
recent news" — it never errors. A run that hits total upstream failure aborts
without writing, so a transient block cannot wipe the last good snapshot.

On throw: `renderError`, 502.

## Admin nuke

`/news?admin=<ADMIN_KEY>` renders **every** article with 🗑 Hide / ↩ Restore
buttons and dims already-hidden ones. Owner-only editorial control with no
accounts and no public voting.

- The button POSTs the article link + the secret to `/api/news/delete` or
  `/api/news/restore`, checked constant-time against the `ADMIN_KEY` Worker
  secret via `isAdmin()` / `timingSafeEqual()`.
- Blocked links are recorded in the worker-owned `news_blocklist` KV key
  (`{link: blockedAtMs}`), auto-pruned past 60 days.
- A hidden article vanishes **instantly** on the next render everywhere:
  `/news`, the homepage card, `/api/news`, `/news.xml`.
- The news routine reads the same key (`loadBlocklist()`) and drops those links,
  so a nuked article **stays gone** even though Google's RSS keeps returning it.
- `loadNews(env, {includeBlocked: true})` is the admin variant: it keeps blocked
  items and annotates them `.blocked`.
- The whole feature no-ops if `ADMIN_KEY` is unset — endpoints 503, buttons never
  render.
- Admin responses are `private, no-store`. No cookies, no visitor data: the
  secret lives in the URL you bookmark and is checked server-side, so the privacy
  model is unchanged. Rotate with `wrangler secret put ADMIN_KEY`.

**Admin renders omit `<link rel="manifest">` and link `/apple-touch-icon.png`
instead.** With a manifest present, iOS "Add to Home Screen" reads its
`start_url` (`/`) and pins the *homepage* rather than the `?admin=` URL — the
web-app URL field is locked when a manifest is present. Dropping the manifest tag
makes iOS bookmark the actual `/news?admin=…` URL as a plain Safari web clip.

Markdown output never gets the admin view: `adminOn` requires `!wantsMarkdown`.

## Canonical & sitemap

- Canonical `https://crosbynews.com/news` · Spanish `/es/news`
- `hreflangTags("/news")`
- In `PAGE_PATHS` → `Link: rel="canonical"`
- `sitemap.xml`: yes — `changefreq: daily`, `priority: 0.6`, no `lastmod`

## Meta

- Title "Crosby, TX News" / "Noticias de Crosby, TX"
- Per-language description covering sourcing and relevance filtering
- `<link rel="alternate" type="application/rss+xml">` → `/news.xml`
- OG title/description/type/url + `OG_COMMON`
- JSON-LD: `JSONLD_SITE` only
- Favicon; manifest **conditional** — see the admin note above

## CSP

Inlines `NEWS_ADMIN_SCRIPT` (`src/assets/client-scripts.js`), but **only when the admin view is active**. It is
hash-allow-listed by `contentSecurityPolicy()` unconditionally, because the CSP
header is computed once per isolate and shared across all responses. The script's
bytes are language-agnostic (labels come from `data-*` attributes), so one hash
serves both languages.

## Locale

Page chrome and category labels via `T()`. **Headlines stay in their publishers'
original language** — they are quoted third-party text, not our copy.
