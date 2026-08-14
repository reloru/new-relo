# GitHub security settings

Current expected state of the repo's GitHub-native security configuration
(Dependabot, CodeQL, alerts). Overwritten in place — no history; see
`docs/README.md`.

## The threat model

**Read this with one fact in mind: nothing in `package.json` ships to
production.** `package-lock.json` is 92 entries, 91 dev-flagged and **zero
non-dev** — the only direct dependency is `wrangler`, the other 90 are its
transitive tree — and `wrangler.jsonc` declares no `assets`/`site`, so the
deployed artifact is the esbuild bundle rooted at `src/index.js` and
nothing else. **A CVE in that tree cannot reach crosbynews.com.** Don't
read a Dependabot alert here as a live-site vulnerability; it isn't one.

The exposure runs the other way: the deploy job runs `npm ci` + wrangler
with `CLOUDFLARE_API_TOKEN` in the environment, so a compromised package
executes next to the credential that can rewrite the site. **The threat
model is supply-chain compromise of the deploy token**, which is why
malware alerts rank above CVE alerts, and why the three floating Action
tags matter as much as npm — same job, same secrets.

## On / off

**On:** dependency graph (verify: `GET /repos/{o}/{r}/dependency-graph/sbom`
→ 95 packages), Dependabot alerts + malware alerts + security updates +
grouped security updates, private vulnerability reporting, CodeQL default
setup + Copilot Autofix.

**Version updates** are configured in `.github/dependabot.yml`:
`github-actions` and `npm`, both **monthly** and grouped. Monthly because
wrangler ships very frequently and weekly would mean a PR most weeks for a
build-only dependency. These PRs get a real gate — the dry-run job runs
`npm ci` + `wrangler deploy --dry-run` — and per the compat-date note in
`docs/ops/ci-cd.md`, bumping wrangler only RAISES the workerd ceiling, so a
bump can't violate `compatibility_date`.

**Deliberately OFF, with reasons** (so they don't get "fixed" later):
- *Automatic dependency submission* — for ecosystems whose deps resolve
  only at build time (Maven/Gradle). npm with a committed lockfile is
  parsed statically; the SBOM above proves it.
- *AI findings (preview)* — covers languages CodeQL doesn't. This repo is
  100% JavaScript, which CodeQL handles natively. Revisit only if a
  non-CodeQL language lands.
- *Dependabot rules* — the fine-grained alternative to "security updates",
  which is already on wholesale. One direct dependency doesn't justify the
  config surface.
- *Check-run failure thresholds* (both left at None) — **the important
  one.** A threshold makes code-scanning failures fail the check run, and
  the merge-autonomy policy (CLAUDE.md, "Claude Code PR workflow") has
  exactly ONE gate (`Syntax check`). Adding a CodeQL severity gate before
  the baseline alert volume is known risks blocking the self-merge
  workflow on advisory findings. If you ever want one, `High or higher`
  (security) + `Errors` (standard) — but look at real alerts first.
- CodeQL's workflow is **advisory only** — do NOT add it to branch
  protection as a required check.

## Why toggles can't be flipped from a session

**These toggles cannot be set from a session — they are dashboard clicks.**
Settled empirically 2026-08-09, and the reason is NOT token scope, so
don't try to fix it with a token: **the egress proxy strips the
`Authorization` header on `api.github.com` and injects its own GitHub App
credential.** Proof: a deliberately bogus token returns 200, and a request
with *no* auth header at all still returns `reloru`. Regenerating/widening
the PAT changes nothing, and `gh` fails identically to `curl` (`gh api
user` works; `gh api repos/{o}/{r}/vulnerability-alerts` returns the same
proxy 403) because it goes through the same `HTTPS_PROXY`. The block is
path-based at the network layer, so the request never reaches GitHub.

Three distinct 403s worth telling apart:
- `"Access to this GitHub API path is not permitted through this proxy."`
  → **egress policy** (`vulnerability-alerts`, `automated-security-fixes`).
  `/root/.ccr/README.md` says to report these, not route around them.
- `"Resource not accessible by integration"` → the injected **App token's**
  permission set (`code-scanning/*`). An App-token error, not a PAT error
  — another tell that the PAT is unused.
- `"Dependabot alerts are disabled for this repository."` → not an error
  at all; that's the feature being off, and it's a usable readout of
  current state.

**Why no credential can fix this, and why the App can't be widened.** Two
independent layers, neither with a user-facing setting. Settled
2026-08-09; don't re-investigate.
1. *The session's credential is not yours.* The proxy strips
   `Authorization` on `api.github.com` and injects a short-lived
   App-backed token — `Github-Authentication-Token-Expiration` is
   same-day, both scope headers come back empty, and
   `/user/installations` answers `"sessions are bound to their configured
   repositories"`. Claude Code on the web documents this: credentials
   "are never inside the sandbox … authentication is handled through a
   secure proxy using scoped credentials."
2. *The App never requests `Administration`.* The Claude GitHub App's full
   declared set is Actions, Checks, Contents, Discussions, Issues (r/w),
   Members, Metadata, Statuses (read), Pull requests, Repository hooks,
   Workflows (r/w). **No `Administration`** — which is what
   `vulnerability-alerts`, `automated-security-fixes` and
   `private-vulnerability-reporting` require. Per the docs you "accept its
   full permission set. GitHub doesn't let you accept a subset," and a
   permission the App doesn't request cannot be granted; only Anthropic
   changing the App manifest adds one (GitHub then prompts the owner to
   approve).

So: a classic PAT with `repo` + `security_events` is already *sufficient*
on paper — it is simply never consulted. Installing `gh` changes nothing
(same `HTTPS_PROXY`; `gh api user` works, `gh api
repos/{o}/{r}/vulnerability-alerts` returns the identical proxy 403).
`/root/.ccr/README.md` says twice to report these rather than route around
them.

**The allowlist is per-path, not per-category** — which is why the
settings above split three ways rather than all failing alike. `/rulesets`
reads fine from a session (that is how the ruleset in `docs/ops/ci-cd.md`
was inspected, and plausibly how it was created), `private-vulnerability-
reporting` reaches GitHub and fails on App permissions, and the two
Dependabot paths never leave the sandbox. Don't generalize from one
endpoint's behavior to another's; probe it.

**Malware alerts and grouped security updates have no REST toggle at
all** — dashboard-only for every GitHub user, not a session limitation.
