# `POST /api/push/subscribe`

Store a browser push subscription.

| | |
|---|---|
| **Handler** | inline in `routeRequest` |
| **Methods** | `POST` only |
| **CORS** | `*` |

## Request

A `PushSubscription` JSON — `{endpoint, keys}` — serialized straight from
`reg.pushManager.subscribe()`.

## SSRF guard

The cron later POSTs to whatever endpoint was stored, so **an arbitrary URL here
would be a server-side request forgery primitive**. `pushEndpointAllowed()`
allowlists real push hosts only:

- `*.googleapis.com`
- `*.push.apple.com`
- `*.notify.windows.com`
- `*.push.services.mozilla.com`

Anything else is rejected 400 before it reaches KV. Do not relax this to
"any https URL".

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | stored |
| 400 | `{"error": "invalid_subscription"}` | body unparseable, `endpoint` not a string, or host not allowlisted |
| 500 | `{"error": "store_failed"}` | KV write threw |
| 503 | `{"error": "push_unavailable"}` | `VAPID_PRIVATE_KEY` unset |

## Storage

One KV entry per subscription under the `push:` prefix. The key is
`await pushKeyFor(endpoint)` — a hash of the endpoint — so **re-subscribing the
same device overwrites rather than duplicating**. Value:
`{endpoint, keys, added}`.

Only an anonymous endpoint and its keys are stored. No personal data, no
identifier the site can tie to a person — which is what `/privacy` claims.

Dead subscriptions are pruned by the cron on a 404 or 410 from the push service.

## Not documented publicly

Same reasoning as `vapid-key.md`.
