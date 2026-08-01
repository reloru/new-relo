# `POST /api/push/unsubscribe`

Remove a stored push subscription.

| | |
|---|---|
| **Handler** | inline in `_fetch` |
| **Methods** | `POST` only |
| **CORS** | `*` |

## Request

```json
{ "endpoint": "https://…" }
```

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | deleted, or already absent |
| 400 | `{"error": "invalid_request"}` | body unparseable or `endpoint` not a string |

**Deliberately idempotent and non-revealing.** The KV delete is wrapped in its
own `try {} catch {}` and a missing key is not an error, so the endpoint cannot
be used to probe whether a given endpoint is subscribed. There is no 503 branch
either — unsubscribing works even if VAPID has since been unconfigured, so a
device can always detach itself.

## Storage

Deletes `await pushKeyFor(endpoint)` from KV — the same hash-of-endpoint key
`subscribe` writes.

The client also calls `sub.unsubscribe()` browser-side, so the browser and the
server both forget it.

## Not documented publicly

Same reasoning as `vapid-key.md`.
