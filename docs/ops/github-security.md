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

## Everything below is about the Claude Code *session* proxy — not `claude.yml`

**The `@claude` GitHub Actions workflow (`docs/ops/ci-cd.md`) bypasses this
proxy entirely.** It runs on a GitHub-hosted Actions runner, not inside the
Anthropic-hosted session sandbox, so none of the credential substitution,
GraphQL pinned-allowlist, or repository-scoping described below apply to it.
It authenticates to GitHub directly (Claude App token or `GITHUB_TOKEN`, per
the action's own precedence) and to Anthropic directly via
`CLAUDE_CODE_OAUTH_TOKEN` — two separate credentials, neither routed through
`HTTPS_PROXY`. So `gh pr list`/GraphQL calls, `vulnerability-alerts`, and
unrestricted-repo API access that all 403 for a session work fine for that
workflow, subject only to its own `permissions:` block and whatever the
token itself is scoped to.

## Why toggles can't be flipped from a session

**These toggles cannot be set from a session — they are dashboard clicks.**
This is the documented behavior of the **GitHub proxy** every Anthropic-
hosted session runs GitHub operations through (Claude Code docs, "GitHub
proxy"), not something reverse-engineered from this repo:
- *Git credentials*: the git client in the VM uses a scoped credential;
  the proxy verifies it and swaps in the real GitHub token.
- *API requests*: requests from the built-in GitHub tools, and from `gh`
  using the proxy-injected placeholder, go out with real credentials
  substituted **by the proxy** — not by whatever is in `GH_TOKEN`/
  `GITHUB_TOKEN` locally. Setting your own token makes it pass through to
  the container unchanged (so a script reading it directly gets a real,
  usable value) — but it does not change what the proxy does with
  `api.github.com` traffic; that substitution/allowlisting happens either
  way.
- *Repository scope*: GitHub API and release-asset requests reach only
  repositories attached to the session — confirmed here by
  `/user/installations` answering `"sessions are bound to their configured
  repositories"`.
- *GraphQL restriction*: the proxy serves only a **pinned allowlist of
  GraphQL operations for pull-request workflows**. Everything else on
  `/graphql` 403s with `"This GraphQL query is not enabled for this
  session"` and names the REST fallback (`gh api repos/{owner}/{repo}/
  ...`) — **regardless of the credentials supplied**, so a real `GH_TOKEN`
  you set yourself gets the identical 403. This is why `gh pr list`,
  `gh repo view`, `gh issue list`, and any other GraphQL-backed `gh`
  subcommand fail here even though `gh api <rest-endpoint>` works fine —
  and why GraphQL-only surfaces (e.g. Projects v2) aren't reachable
  through this proxy at all. Use REST via `mcp__github__*` or
  `gh api repos/{owner}/{repo}/...` instead.

Three distinct 403 messages seen against this repo, worth telling apart
(verified 2026-08-15 still match):
- `"Access to this GitHub API path is not permitted through this proxy."`
  → **egress allowlist** (`vulnerability-alerts`, `automated-security-fixes`).
  `/root/.ccr/README.md` says to report these, not route around them.
- `"Resource not accessible by integration"` → the substituted credential's
  own permission set is insufficient (`code-scanning/*`). Distinct from
  the egress-allowlist message above — this one means the request reached
  GitHub and GitHub itself said no.
- `"Dependabot alerts are disabled for this repository."` → not an error
  at all; that's the feature being off, and it's a usable readout of
  current state.

**Regenerating or widening a token you set yourself does not change any of
this.** The proxy's substitution and allowlisting apply uniformly — proven
directly: a deliberately bogus `Authorization` value and a request with no
auth header at all both still return `reloru`'s real data through
`api.github.com`, and a real, well-formed `GH_TOKEN`/`GITHUB_TOKEN` (a
fine-grained PAT / classic PAT, confirmed 2026-08-15 by echoing both) gets
the identical `vulnerability-alerts` 403 and the identical GraphQL 403.
Whether the specific "`Resource not accessible by integration`" failures
trace to a GitHub App's declared permission set specifically (as opposed
to some other scope on the substituted credential) isn't independently
re-verifiable from inside a session — treat that detail as unconfirmed;
the actionable fact is the one proven above: **no token change from
inside a session moves any of these three error categories.**

**The allowlist is per-path, not per-category** — which is why the
settings above split three ways rather than all failing alike. `/rulesets`
reads fine from a session (that is how the ruleset in `docs/ops/ci-cd.md`
was inspected, and plausibly how it was created), `private-vulnerability-
reporting` reaches GitHub and fails on the substituted credential's
permissions, and the two Dependabot paths never leave the sandbox. Don't
generalize from one endpoint's behavior to another's; probe it.

**Malware alerts and grouped security updates have no REST toggle at
all** — dashboard-only for every GitHub user, not a session limitation.
