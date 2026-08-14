# Email auth (SPF/DKIM/DMARC — lives in Cloudflare DNS, not the Worker)

Current expected state of the domain's email-authentication records.
Overwritten in place — no history; see `docs/README.md`.

- The domain receives mail via **iCloud Custom Email Domain** (the
  published `contact@` and `security@crosbynews.com` addresses). The MX
  records (`mx01`/`mx02.mail.icloud.com`), SPF
  (`v=spf1 include:icloud.com ~all`), and DKIM (`sig1._domainkey` CNAME →
  iCloud, key published) are all **iCloud-managed** — created by Apple's
  domain-setup flow, not this repo. The Worker sends no email.
- **DMARC is the one record we own.** `_dmarc.crosbynews.com` publishes a
  policy so receivers can reject mail spoofing the domain (e.g. phishing
  as `security@`) and so aggregate reports flow back. Reproduce/update
  with `node scripts/dmarc.mjs` (idempotent). Same Cloudflare-token rules
  as DNS-AID (`docs/ops/dns-aid.md`): `Zone:DNS:Edit` to write, plus
  `Zone:Zone:Read` to resolve the zone id by name — or set
  `CLOUDFLARE_ZONE_ID=09de1864babbf541c26590b0fe42f25f` and a
  DNS:Edit-only token suffices.
- **Rollout ladder (complete):** `p=none` → `p=quarantine` (2026-07-07) →
  **`p=reject`** (2026-07-28 at the user's direction), the final rung —
  mail spoofing `security@`/`contact@` is now hard-rejected by receivers,
  not just quarantined. **The live record's `rua` has two recipients, not
  just the script's default:**
  `mailto:282e2a686e3c4a1fadc35dbc7b496a67@dmarc-reports.cloudflare.net`
  (Cloudflare's own DMARC-monitoring address, added out-of-band — not by
  `scripts/dmarc.mjs`, which only knows `security@crosbynews.com`) plus
  `mailto:security@crosbynews.com`. **Re-running `scripts/dmarc.mjs`
  as-is would silently drop the Cloudflare address** (it overwrites the
  whole record with just its one `rua`), so any future policy change
  should PATCH the existing record's `p=` in place (or update the script
  to preserve both recipients) rather than re-running it unmodified.
  `security@crosbynews.com` must stay a real iCloud mailbox/catch-all or
  its half of the reports is silently lost.
- No SMTP port-blocking or Spamhaus PBL concern applies here: there's no
  origin server/VPS sending mail (Cloudflare Worker, no public SMTP IP),
  and outbound mail leaves from iCloud's own (non-PBL) IPs.
