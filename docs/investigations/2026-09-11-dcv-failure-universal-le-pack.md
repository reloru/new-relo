# 2026-09-11 — DCV failure on the universal Let's Encrypt pack

Cloudflare emailed a Domain Control Validation failure for certificate pack
`d0b8e012-ddd6-48b1-a209-c5cb98a06008` (zone `crosbynews.com`, method `txt`) and
asked for two TXT records to be created at `_acme-challenge.crosbynews.com`:

```
2Tj58AflEOsARV080ZKb-n-tzCKRm19BIjDOpOAgjz8
CRJRaSUGzgIYpBZkc9FiZwU917CKqZWcIXIU-c0oeQk
```

**No record was added, and none should have been.** Both values were already
published and resolving before anything was touched, and both were stale within
four minutes. The email's remediation instructions do not apply to a zone on
Cloudflare's nameservers.

## The requested records already existed — just not as zone records

Cloudflare's DNS record list carries exactly two TXT records at that name, and
neither is one of the email's values:

| content | created_on | in record list | resolving 01:50Z |
|---|---|---|---|
| `7GaAGLNcLHUBz5c1GqimlS7nP96ATlP5K6ESLBf-vIU` | 2026-07-28T20:20:33Z | yes | yes |
| `6MJ1SYvglf8znPModeIOAVcHnnf6gH6wcvd0kD0FS1Y` | 2026-07-28T20:20:31Z | yes | yes |
| `2Tj58AflEOsARV080ZKb-n-tzCKRm19BIjDOpOAgjz8` | — | **no** | yes |
| `CRJRaSUGzgIYpBZkc9FiZwU917CKqZWcIXIU-c0oeQk` | — | **no** | yes |

The bottom two answered from Cloudflare's authoritative nameservers without
existing as editable records, because `crosbynews.com` is a **full setup**
(`/zones/{id}` → `"type": "full"`). Per Cloudflare's DCV flow documentation,
"Cloudflare either places the tokens on your behalf (Full DNS setup, Delegated
DCV), or makes the tokens available for you to place them." This zone is the
first case. The manual-record instructions in the email are the second case,
written for zones whose authoritative DNS is elsewhere.

## And they were stale almost immediately

The same documentation states "DCV tokens will change upon verification
failures." Measured directly against all six authoritative anycast IPs, the
auto-placed pair had already rotated minutes later, while the two 2026-07-28
records stayed put:

```
01:50Z   6MJ1…  7GaA…  2Tj58…  CRJRa…
01:53Z   6MJ1…  7GaA…  TOsoPdEK9gIXG8fU-0NXB9Rwmq37FWrjL8ApXbgEn44
                       bm3_vd0UTDkxgW0OacwTVdmQ77rYjTy8qTk9E7jR3mU
```

Pasting a token out of a DCV email into this zone therefore produces a record
that matches no live ACME order — permanent junk in the RRset, not a fix.

**That is almost certainly what the two 2026-07-28 records are.** They were
created at 20:20:31Z and 20:20:33Z, two and a half minutes *after* the advanced
pack's certificates were issued (`modified_on` 2026-07-28T20:17:53Z) — the
signature of an earlier DCV email followed literally. They are inert, but
deleting them buys nothing and cannot be proven safe against the backup pack, so
they stay.

## The real failure is CA-side, and not about our records at all

`GET /zones/{zone}/ssl/certificate_packs/{id}` → `validation_errors`:

```
the Certificate Authority had trouble performing a DNS lookup: during secondary
validation: dns problem: networking error looking up txt for
_acme-challenge.crosbynews.com
```

"Secondary validation" is Let's Encrypt's multi-perspective corroboration: the
CA re-queries from several geographic vantage points. A networking error there
means one perspective could not complete the lookup. Everything on our side that
could cause it was checked and is clean:

- **Records resolvable** — the full RRset returned from Google Public DNS,
  Cloudflare's resolver, and all six authoritative IPs directly
  (`173.245.58.138`, `172.64.32.138`, `108.162.192.138`, `108.162.195.206`,
  `172.64.35.206`, `162.159.44.206`).
- **DNSSEC valid** — zone DNSSEC `active` (alg 13, key tag 2371), DS published
  at the parent, and `AD: true` on every validating-resolver answer.
- **CAA permits the CA** — both `issue "letsencrypt.org"` and
  `issuewild "letsencrypt.org"` are present, which the wildcard host needs.
- **No delegation at the challenge name** — `_acme-challenge.crosbynews.com` has
  no CNAME, so nothing redirects the lookup off the zone.
- **Only the wildcard is pending** — `/zones/{zone}/ssl/verification` lists
  `*.crosbynews.com` alone, with `verification_info` null (the API does not
  expose the expected token values for an auto-placed pack, so the email is the
  only place they appear).

Nothing observable from inside this repo can distinguish a transient vantage-
point failure from a persistent one; the failing perspective is the CA's.
Cloudflare "will automatically retry validation according to the validation
backoff schedule," and was visibly mid-retry during this investigation (pack
`modified_on` advanced from 01:50:08Z to 01:53:44Z with the same error).

## Live site impact: none

| pack | type | CA | status | expires |
|---|---|---|---|---|
| `a8029e2a-f5f1-4b36-9d9c-266c5fd9dcfa` | advanced | Google Trust Services | **active** | 2026-10-26 |
| `93d3aa71-37fa-4d94-8d4f-a3c872c1f609` | universal | Google Trust Services | backup_issued | — |
| `d0b8e012-ddd6-48b1-a209-c5cb98a06008` | universal | Let's Encrypt | pending_validation | 2026-10-12 (unissued) |

The edge serves the active advanced pack, which covers both `crosbynews.com` and
`*.crosbynews.com`. The pending LE universal pack is not what terminates TLS
today, so a stuck DCV is not an outage.

**Unverified from this session:** the leaf certificate a browser actually
receives. The session's egress proxy terminates TLS, so `openssl s_client`
returns the proxy's own certificate (`CN = Egress Gateway SDS Issuing CA`), not
Cloudflare's. Confirming the served issuer needs a check from outside this
sandbox.

## The deadline that matters

Not the DCV email, and not the LE pack's 2026-10-12 date (that pack holds no
issued certificate). It is **2026-10-26**, when the active advanced pack
expires. If `d0b8e012` is still `pending_validation` as that approaches, or if
the advanced pack's own renewal starts reporting validation errors, the failure
has stopped being cosmetic. Until then the correct action is none.

## Commands

```bash
Z=09de1864babbf541c26590b0fe42f25f; H="authorization: Bearer $CLOUDFLARE_API_TOKEN"
curl -sS -H "$H" "https://api.cloudflare.com/client/v4/zones/$Z/ssl/certificate_packs?status=all"
curl -sS -H "$H" "https://api.cloudflare.com/client/v4/zones/$Z/ssl/certificate_packs/<pack-uuid>"   # validation_errors
curl -sS -H "$H" "https://api.cloudflare.com/client/v4/zones/$Z/dns_records?type=TXT&per_page=100"
curl -sS 'https://dns.google/resolve?name=_acme-challenge.crosbynews.com&type=TXT'                   # what is actually published
```
