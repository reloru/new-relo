# 2026-09-11 — how the DCV failure actually ended, and the CA switch that followed

Supersedes the framing in `2026-09-11-dcv-failure-universal-le-pack.md`, which is
correct on mechanism and wrong on outcome: it treats the failure as open-ended
and names 2026-10-26 as the deadline to watch. Both dated files stay as written.

## It fixed itself, before anything was changed

The Let's Encrypt universal pack `d0b8e012-ddd6-48b1-a209-c5cb98a06008` went
`active` at **2026-09-11T02:21:47Z** with a certificate valid through
2026-12-10, on Cloudflare's own retry backoff. That is about eight minutes after
the last observation in the earlier file, which recorded it still failing at
02:13Z with a Let's Encrypt secondary-validation DNS error.

Nothing was done to make that happen. The owner's "still getting emails" report
arrived while the pack was already active — the emails were from the retry
window, which had closed.

## The CA switch, and what it cost

At **04:59:59Z**, roughly two and a half hours after the pack had already gone
active, Universal SSL's CA was changed on the owner's instruction:

```
PATCH /zones/{zone}/ssl/universal/settings   {"enabled":true,"certificate_authority":"google"}
```

The decision was made on the 02:13Z picture. It was unnecessary, and it was not
free: changing the setting **retires the existing universal pack and orders a new
one**. Observed sequence:

| time | state |
|---|---|
| 04:59:59Z | PATCH accepted, setting reads back `google` |
| 05:00:33Z | new universal pack `2d8fce97-…` exists, `pending_validation`, its two tokens already published |
| 05:02:33Z | new pack `active`, no validation errors |

End state, from four packs to two, both Google, nothing pending:

| pack | type | CA | status | expires |
|---|---|---|---|---|
| `a8029e2a-f5f1-4b36-9d9c-266c5fd9dcfa` | advanced | Google | active, serves the site | 2026-10-26 |
| `2d8fce97-44db-49f9-877e-17ffb8115c5a` | universal | Google | active | 2026-12-10 |

The Let's Encrypt pack and the previous Google universal backup
(`93d3aa71-…`, `backup_issued`, 2026-11-04) are both gone from
`/ssl/certificate_packs?status=all`. Cloudflare manages backup packs on its own;
whether it re-creates one here was not observed.

**Not verified:** the leaf a browser now receives. The session's egress proxy
terminates TLS, so `openssl s_client` returns the proxy's certificate. The
advanced pack still takes precedence and did not change, so the served chain
should be unchanged — an external check is what would confirm it. The owner's
mxtoolbox check at 02:17Z matched the advanced pack's ECDSA certificate exactly
(issuer WE1 → GTS Root R4, sha256ECDSA, 7/28/2026–10/26/2026), which is how the
"advanced pack serves" claim was established in the first place.

## The lesson, which is about timing and not about TLS

**A single DCV-failure email is a snapshot of one failed attempt, not a standing
condition.** Cloudflare retries on a backoff and rotates tokens each time, so by
the time anyone reads the email the order it describes is already gone. Acting on
one means acting on state that no longer exists.

Before changing any zone setting in response to a DCV email, re-read the pack:

```bash
Z=09de1864babbf541c26590b0fe42f25f; H="authorization: Bearer $CLOUDFLARE_API_TOKEN"
curl -sS -H "$H" "https://api.cloudflare.com/client/v4/zones/$Z/ssl/certificate_packs?status=all"
```

If it is `active`, there is nothing to fix. If it is still
`pending_validation`, check `validation_errors` on the pack itself and give the
backoff time — a failure that clears in minutes needs no intervention at all.
The escalation threshold is a pack stuck past the point where the **serving**
pack's expiry starts to matter, not the arrival of an email.

A second, smaller correction: re-measuring the same state at intervals would have
caught this. The earlier investigation sampled the pack four times inside four
minutes and then stopped. One more sample ten minutes later would have shown
`active` and the CA switch would never have been proposed.
