# `POST /api/news/restore`

Un-hide a previously hidden news article. The inverse of
`/api/news/delete`, sharing one handler branch.

Everything in `docs/endpoints/api/news/delete.md` applies — request shape, auth,
status codes, storage, and the deliberate absence from every public discovery
surface. Two differences:

| | `delete` | `restore` |
|---|---|---|
| Blocklist effect | `cur[link] = Date.now()` | `delete cur[link]` |
| Success body | `{"ok": true, "blocked": true}` | `{"ok": true, "blocked": false}` |

The 60-day prune runs on this path too, so a restore also garbage-collects stale
entries.

The `/news?admin=` UI flips a row's button between the two actions in place after
a successful call, without a reload.
