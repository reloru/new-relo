# Analytics

Current expected state of visitor measurement for crosbynews.com. Overwritten in
place — no history; see `docs/README.md`.

**There is no analytics. Nothing counts visitors, in the browser or at the edge.**

## What the site ships

- **No analytics script of any kind.** No first-party counter, no third-party
  service, no pixel, no beacon.
- The CSP allows **no third-party script origin at all**
  (`contentSecurityPolicy()`, `src/discovery.js`). `script-src` is same-origin
  plus three inline hashes; `connect-src` is `'self'`. Adding any analytics
  vendor means widening both — treat that as the signal to re-read this file.
- `/privacy` and `/about` state this in both languages. **The claim and the code
  must move together**: `PRIVACY`/`PRIVACY_ES` (`src/pages/privacy.js`),
  `ABOUT`/`ABOUT_ES` (`src/pages/about.js`), and the CSP are one change, not
  four.

## Cloudflare Web Analytics — removed 2026-08-19

The zone previously ran Cloudflare Web Analytics with **automatic injection**.
Cloudflare inserted this at the edge, *after* the Worker had produced the
response, so it never appeared anywhere in this repo:

```html
<!-- Cloudflare Web Analytics --><script type='module'
  src='https://static.cloudflareinsights.com/beacon.min.js'
  data-cf-beacon='{"token": "..."}'></script><!-- End Cloudflare Web Analytics -->
```

It was **deleted** (not merely disabled) on 2026-08-19, along with its ~3 months
of collected data. The site config, its `site_tag` and its token are gone;
`GET /accounts/{account_id}/rum/site_info/list` returns zero sites. Re-enabling
means creating a **new** Web Analytics site with a new token.

Why it was removed: `/about` and `/privacy` claimed "no third-party analytics
scripts… on any page" while the beacon was loading on every page, and Safari's
Privacy Report listed `cloudflare.com` as a tracker contacted by crosbynews.com.
Safari was blocking it anyway, so the counts already excluded Safari visitors —
the site was paying the credibility cost of a tracker for data it wasn't fully
getting.

### The gotcha, if this is ever revisited

The beacon is **invisible to a plain `curl`**. Cloudflare only injects it for
requests that look like a browser, so:

```bash
curl -s https://crosbynews.com/ | grep -c cloudflareinsights            # 0
curl -s -A "Mozilla/5.0 (iPhone; …) Safari/604.1" \
     -H 'Accept: text/html' https://crosbynews.com/ | grep -c cloudflareinsights  # 1
```

Checking for edge-injected scripts with a default user-agent proves nothing. Use
a real browser UA **and** an HTML `Accept` header.

### Turning it off is not one switch

Three settings look like they'd stop injection. Only the last one did:

| Change | API | Result |
|---|---|---|
| `auto_install: false` | `PUT /rum/site_info/{site_tag}` | Dashboard flipped to "Enable with JS Snippet installation". **Beacon still injected.** |
| Rule `is_paused: true` | `PUT /rum/v2/{ruleset_id}/rule/{rule_id}` | Accepted. **Beacon still injected.** |
| Site disabled, then deleted | dashboard | Beacon gone; confirmed 0 hits across `/`, `/es`, `/weather`, `/alerts`, `/news`. |

Note `PUT /accounts/{account_id}/rum/v2/{ruleset_id}` returns
`10001 Unable to authenticate request` for both `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ZONE_API_TOKEN` — that path is outside their scope. The RUM API is
also aggressively rate-limited (`971 Please wait and consider throttling`);
back off rather than retrying tight.

## What still observes traffic

Cloudflare keeps aggregate server-side request logs as part of serving the site,
the way any host does. That is not a browser-side tracker, carries no analytics
identifier, and is disclosed in the `/privacy` Analytics section. Zone analytics
in the Cloudflare dashboard are derived from those logs and need no script.
