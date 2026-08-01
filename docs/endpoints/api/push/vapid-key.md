# `GET /api/push/vapid-key`

The public VAPID key, so a browser can create a push subscription.

| | |
|---|---|
| **Handler** | inline in `_fetch` |
| **Cache** | `public, max-age=3600` |
| **CORS** | `*` |

## Response

```json
{ "key": "<VAPID_PUBLIC_KEY>" }
```

`{"key": null}` when the secret is unset. **That null is the feature's off
switch**: `PUSH_CLIENT_SCRIPT` returns early on a null key, so the opt-in UI on
`/alerts` never appears. The whole push feature no-ops cleanly rather than
half-rendering.

## Key rotation

`VAPID_PUBLIC_KEY` (base64url raw P-256 point) and `VAPID_PRIVATE_KEY` (private
JWK JSON) are Worker secrets, set with `wrangler secret put` and mirrored into a
gitignored `.dev.vars` for local dev.

**Rotating invalidates every existing subscription.** Browsers bind a
subscription to the applicationServerKey it was created with, so subscribers have
to opt in again. Rotate only when necessary.

## Not documented publicly

Absent from `/openapi.json`, the api-catalog, `llms.txt` and `README.md` — it is
internal wiring for the `/alerts` opt-in UI, not a public data API.
