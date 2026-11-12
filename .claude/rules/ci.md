---
paths:
  - ".github/**"
  - "wrangler.jsonc"
  - "package.json"
  - "package-lock.json"
---

# CI, workflows and config

- Never rename the jobs "Syntax check" and "Build check (dry-run)": branch
  protection keys on the names. Detail: `docs/ops/ci-cd.md`.
- `compatibility_date` may only be raised, never guessed.
- Nothing in `package.json` ships; the threat model is the deploy token
  (`docs/ops/github-security.md`).
- `claude.yml` (`@claude`): `allowed_bots` is exactly `"github-actions[bot]"`,
  never `"*"`, and the job's `if:` admits a bot only on an `issues`/`opened`
  event carrying the `pollen-watch` label. Change the two together.
- `pollen-watch.yml` files a `pollen-watch`-labelled issue, with the label
  set at creation, when HHD lists a measured count newer than `/api/pollen`
  serves (`docs/pages/pollen.md`).
