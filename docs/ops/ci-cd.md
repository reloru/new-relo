# CI / GitHub Actions

Current expected state of `.github/workflows/deploy.yml` and the branch-merge
gates it feeds. Overwritten in place — no history; see `docs/README.md`.

## The three jobs

`.github/workflows/deploy.yml` runs three jobs on every push/PR to `main`:

- **Syntax check** (`find src -name '*.js' -print0 | xargs -0 -n1 node --check`)
  — runs on all PRs and pushes. A required status check (protection keys on
  the exact name "Syntax check", so don't rename this job). It covers
  **every file under `src/`, not just the entry point**: `node --check`
  validates one file at a time and does not follow imports, so checking
  only `src/index.js` would go green while an imported module was
  unparseable.
- **Build check (dry-run)** (`npm ci` + `npx wrangler deploy --dry-run`) —
  runs on all PRs and pushes. Parses `wrangler.jsonc` and bundles the Worker
  without uploading, catching config/bundling errors and the
  compat-date/wrangler-pin coupling that `node --check` can't see. No auth
  needed (`--dry-run` uploads nothing). **Also a required check** — verified
  2026-08-09 in `new-relo-main-ruleset`, which lists both this and
  "Syntax check" as `required_status_checks`. (This entry previously said it
  was NOT required and that adding it "needs the admin API"; both were
  stale.) The deploy job also `needs` it, so a broken build blocks the prod
  deploy independently of the merge gate.
  It resolves imports, so it catches a missing or renamed export across
  files — a failure `node --check` cannot see.
  **But it does NOT catch a module using another module's export without
  importing it**: esbuild treats an unresolved identifier as a *global* and
  emits no error. That gap is covered by the next step.
- **Check cross-module references** (`node scripts/check-module-refs.mjs`)
  — runs inside the required `Syntax check` job (pure node, no install).
  Flags any module referencing a name exported elsewhere under `src/`
  without importing or declaring it. Added after a real escape during the
  decomposition: `src/lib/format.js` used `TZ` without importing it and
  BOTH gates went green. It wouldn't even have crashed — `fmt()` wraps its
  body in try/catch and returns `""`, so every timestamp, day heading and
  "Updated" stamp on the site would have silently rendered empty. A
  swallowed `ReferenceError` is worse than a loud one.
  **It has a known blind spot**: it does not descend into a template
  literal nested inside a `${...}` substitution, so
  `${lang === "es" ? \`<p>${ES_NWS_NOTE}</p>\` : ""}` is invisible to it.
  That exact line shipped `/es/hourly` as a **502 in production** with all
  three gates green.
- **Check renderers (both languages)** (`node scripts/check-renders.mjs`)
  — also in the required job. Imports every module and calls every
  `*Html`/`*Markdown`/`api*`/`jsonld*` export with stub data **in both `en`
  and `es`**, failing on `ReferenceError`. Running the code is the only
  ground truth; every static approximation of "is this name in scope" has
  so far found a new way to be wrong. **The two-language sweep is the
  point** — roughly half the site's render branches never execute under
  `lang="en"`, which is why `/hourly` was fine while `/es/hourly` was down.
- **Deploy** (`cloudflare/wrangler-action@v3`) — runs on push to `main`
  only, after BOTH checks pass (`needs: [check, build]`). Has a
  `concurrency: { group: deploy-production, cancel-in-progress: false }`
  guard so two quick squash-merges deploy in order instead of racing
  (wrangler is last-write-wins).

## `wranglerVersion` pin

`wranglerVersion: "4"` is kept explicit in the wrangler-action config, but
it is **no longer load-bearing**: since `cloudflare/wrangler-action@v4`
(merged 2026-08-09, PR #164) the action installs wrangler 4.x by *default*.
Under `@v3` it defaulted to 3.x, which can't parse `wrangler.jsonc` and
failed with "Missing entry-point" — that was the reason for the pin. Keep
the line anyway: it costs nothing and states the intent explicitly.

**CI cannot catch a regression here.** The build job runs
`npx wrangler deploy --dry-run` directly, not through the action, so
wrangler-action itself is exercised ONLY by the deploy job — which runs
post-merge on `main`. Read a wrangler-action major bump's release notes
before merging it; a green PR proves nothing about it.

The deploy action installs the latest 4.x; the build-check job and local
dev use the repo's pinned `wrangler` devDependency (see `package.json`, via
`npm ci`) so the dry-run and the prod runtime stay aligned.
**`package.json` is the only place the version number lives — don't repeat
it here.**

## Compatibility date

**The constraint is one-directional.** `compatibility_date` (currently
`2026-08-11`, raised from `2026-07-01` alongside the wrangler 4.121.0 bump
— verified locally: `npx wrangler dev` boots clean at `2026-08-11` and
fails outright one day later with `"the newest date supported by this
server binary is 2026-08-11"`, confirming that was the actual ceiling, not
a guess) must be ≤ the bundled `workerd`'s ceiling. Bumping `wrangler`
RAISES that ceiling, so a version bump can never violate it and needs no
boot check. Only RAISING the date is risky ("The Workers runtime failed to
start"), and CI never runs `wrangler dev`, so that's the one change worth a
local `npx wrangler dev`.

## Verification gate

`node --check` + `npx wrangler deploy --dry-run`. Runtime coverage comes
from `/verify-site` against the live deploy, not a local boot. Don't add
`wrangler dev` to routine checks — it's a server, so it never exits 0
(timeout → 124, SIGTERM → 143) and reads as failed after serving fine.
Judge it by HTTP, not exit status. `scripts/test-sw-offline.mjs` is the one
legitimate user and already does this right.

**`wrangler <cmd> | head -N` hangs** — wrangler doesn't exit on EPIPE, so a
short `head` wedges it until the command timeout. `--version | head -2`
hangs; `| head -20` is fine. Redirect to a file, or use `tail`.

## Runtime / secrets

- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` is set on the deploy step
  (GitHub is migrating Actions to Node 24; this opts in early to suppress
  deprecation failures).
- The workflow installs **Node 22** via `actions/setup-node@v4` for the job
  steps (the `node --check` syntax check runs on it). That's separate from
  `FORCE_..._NODE24`, which targets GitHub's JS-Actions runtime, not the
  Node the steps themselves use.
- Repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set at
  the repository level — same token as used by the manual deploy path.

## Branch workflow after a squash-merge

PRs are squash-merged. After a squash-merge, the old branch diverges from
main (its history is rewritten into one commit). Always branch fresh off
`origin/main` before starting new work; never reuse a branch that was
already merged **by just continuing to commit on it** — main has a
rewritten single commit where your branch has the full original history,
so a naive push diverges or conflicts.

There's one sanctioned exception, used repeatedly across PRs #48–70: to
keep working on the *same* long-lived feature branch across many small
PRs, reconcile immediately after each squash-merge with
`git fetch origin main && git merge -X ours origin/main` (merge, not
rebase) and push, before opening the next PR from that branch. `-X ours`
discards the now-redundant diff (main already has your changes, squashed)
while keeping the branch valid for a fresh PR. This is different from
resuming a stale branch untouched — always reconcile first.

## Branch protection: two systems at once

The repo is **public** and **MIT licensed** (`LICENSE`, added 2026-08-09;
`package.json`'s `license` field matches). `main` is protected by **two
systems at once** — classic branch protection AND a repository ruleset
(`new-relo-main-ruleset`, created 2026-08-05). They do not override each
other: **GitHub evaluates both and applies the union, most-restrictive
wins.** So the effective rules are the superset, and "why did this merge
get blocked" has two places to look. GitHub's own direction is to migrate
classic → rulesets rather than run both; consolidating is the tidy end
state, but **compare them side by side before deleting either**, since a
session cannot read the classic settings (`branches/main/protection` →
403, needs `Administration`) and so cannot prove they are equivalent.

The ruleset (readable, and verified 2026-08-09) enforces: `deletion` +
`non_fast_forward` (no force-push, no branch deletion), `pull_request` with
`required_approving_review_count: 0` (a PR is **mandatory** — no direct
pushes to `main` — but needs no approval, which is what makes solo
squash-merges work), `required_linear_history`, and
`required_status_checks` listing **both** `Syntax check` and
`Build check (dry-run)` with **`strict_required_status_checks_policy:
true`** — so a PR **must** be up to date with `main` before merging. (This
entry previously said classic-only, `Syntax check`-only, and `strict` off.
The `strict` one bites in practice: if `main` moves while your PR is open,
update the branch before merging.)

**Also a `code_scanning` rule** (added 2026-08-09, once CodeQL reached a
zero-alert baseline — see `docs/ops/github-security.md`):
`{tool: "CodeQL", alerts_threshold: "errors", security_alerts_threshold:
"high_or_higher"}` — mirrors the "Check runs failure threshold" values
(Standard: Only errors, Security: High or higher) exactly, so there is one
threshold decision, not two. **Deliberately not** the `CodeQL` check run
added as a `required_status_check` — this ruleset-native rule is the
correct mechanism instead: it evaluates alerts directly rather than
trusting the check run's conclusion (which reported `neutral`, not
`success`, on PR #164), and it also blocks a merge if the tool is
unconfigured or still scanning, which a status check would not catch. Do
not add both — that recreates the "two places to look" problem above.

**`Analyze (javascript-typescript)` / `Analyze (actions)` are NOT required
anywhere** — those check runs report only that a scan completed, not its
findings, so requiring them gates nothing. Same for `Dependabot` (only
appears on Dependabot's own PRs) and `Deploy to Cloudflare Workers`
(`if: push to main` — never runs on a PR): requiring either would deadlock
every PR forever, with no session-side fix (ruleset writes are
proxy-blocked, same as the endpoints described in
`docs/ops/github-security.md`).

**`Require code quality results` and `Restrict code coverage` are
available in the ruleset UI but must stay OFF** — this repo has neither
GitHub Code Quality nor any coverage-instrumented test run wired up
(`grep -riE "nyc|c8|istanbul|coverage" package.json .github/workflows/` →
nothing), so either would create the identical deadlock: a required gate
no tool ever satisfies. Enabling would need standing up the underlying
tool first and confirming it posts results on a real PR — never flip the
ruleset rule before that.

Secret scanning + push protection are **on** (free on public repos): a push
containing a detectable secret is blocked before it lands.
