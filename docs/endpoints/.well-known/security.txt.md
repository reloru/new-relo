# `GET /.well-known/security.txt`

RFC 9116 security contact.

| | |
|---|---|
| **Handler** | inline in `_fetch` |
| **Content-type** | `text/plain; charset=utf-8` |
| **Cache** | `public, max-age=86400` |

## Body

```
# Security contact for crosbynews.com
Contact: mailto:security@crosbynews.com
Expires: <now + 365 days, ISO>
Preferred-Languages: en
Canonical: https://crosbynews.com/.well-known/security.txt
```

**`Expires` is computed at request time**, one year out, so the file can never go
stale — the failure mode RFC 9116 files usually hit.

## The Cloudflare override gotcha

Cloudflare's **zone-managed security.txt** (dashboard → Security Center)
silently overrides this route at the edge with a fixed `Expires`. It was found
enabled during the 2026-07-02 audit and disabled.

**Keep it OFF**, or the self-refreshing version never reaches anyone. If the
served `Expires` ever stops moving, check that setting first.

## Contact address

Must match `/contact` and stay a real iCloud mailbox — it is also a DMARC `rua`
recipient. See `docs/pages/contact.md`.

## Advertised by

`llms.txt`'s `## Optional` section and the `/sitemap` page.
