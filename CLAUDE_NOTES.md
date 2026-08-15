# CLAUDE_NOTES.md — catch-all

Anything worth knowing that doesn't fit `CLAUDE.md`'s cross-cutting
invariants, a `docs/pages/`/`docs/endpoints/`/`docs/ops/` state file, or a
dated `docs/audit/`/`docs/investigations/` write-up. Same convention as
those state files: **current, overwritten in place — not a journal.** If an
entry here turns out to be a real cross-cutting invariant every session
needs, promote it into `CLAUDE.md` instead of leaving it stranded here.

## Tooling gotchas (agent session mechanics)

- **`gh` CLI**: pre-installed via the cloud environment's startup script —
  check with `command -v gh` before assuming it's missing. The script
  installs from **GitHub's own apt repo** (`cli.github.com/packages`,
  owner-switched 2026-08-09 from the Ubuntu-community package). Ubuntu's own
  notice for that community package: *"The GitHub CLI package is synced
  from upstream Debian Community package. Note: As of November 2025, GitHub
  CLI maintainers strongly recommend official Debian packages especially as
  the community-distributed 2.45.x / 2.46.x version is broken due to
  deprecated GitHub APIs."* Confirmed 2026-08-15 in this container:
  `apt-cache policy gh` shows `2.97.0` installed from
  `https://cli.github.com/packages` (the official repo, not the Ubuntu
  `noble`/`noble-updates` `2.45.x` candidates also listed). Falling back to
  `apt-get install -y gh` in an environment that doesn't run the script
  gets that outdated Ubuntu-community `2.45.x` instead — if the fallback
  ever matters, prefer reproducing the official-repo script instead — the
  actual startup script:

      #!/bin/bash
      type -p wget >/dev/null || (apt update && apt install wget -y)
      mkdir -p -m 755 /etc/apt/keyrings
      out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg
      cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
      chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
      mkdir -p -m 755 /etc/apt/sources.list.d
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
      apt update
      apt install gh -y

  Auth needs no setup — `GH_TOKEN`/`GITHUB_TOKEN` are set in the environment
  (confirmed 2026-08-15: well-formed `github_pat_…` / `ghp_…` values), so
  **never `gh auth login`**. Whether that's a real token you set yourself
  (passes through unchanged, used directly) or the GitHub proxy's own
  placeholder (substituted with real credentials on the way out) doesn't
  change what works: `gh api <rest-endpoint>` is fine either way; `gh auth
  status` false-negatives regardless — check with `gh api user` instead.
  **GraphQL-backed subcommands (`gh repo view`, `gh pr list`, `gh issue
  list`, raw `gh api graphql`) 403 through the proxy no matter what
  credential is supplied** — the proxy serves only a pinned allowlist of
  GraphQL operations for PR workflows and rejects everything else with
  `"This GraphQL query is not enabled for this session"`. Use REST instead:
  `gh api repos/{owner}/{repo}/...` (or `mcp__github__*`). GraphQL-only
  GitHub surfaces (e.g. Projects v2) aren't reachable through this proxy at
  all. Full detail: `docs/ops/github-security.md`.
- **Parse GitHub API JSON with `jq` or `python3`, never `grep`** — fields
  sit on separate lines, so a pattern spanning two of them silently never
  matches and a poll loop spins forever.
- **A post-deploy `curl` can be WRONG for a minute or two, and a
  cache-buster does not help.** A new Worker version propagates across
  Cloudflare's colos over roughly 1–2 minutes, and requests fan out across
  them — so a request with a brand-new `?cb=` query string can still be
  served by an edge running the PREVIOUS version. This is version
  propagation, not caching, which is why the usual cache-busting trick
  does nothing for it. Measured 2026-08-05 on `/es/developers`: 7 of 8
  fresh requests showed the new build and 1 showed the old, for about two
  minutes after the deploy job went green; three separate "final"
  verifications that day were briefly wrong because they sampled once and
  happened to hit the stale edge. **Sample ~8 times and require them to
  agree** before calling a deploy verified:

      for i in $(seq 1 8); do curl -s "$URL?cb=$RANDOM-$i" | grep -c "$MARKER"; done

  Separately, edge *caching* is real too and behaves differently: content
  pages carry `max-age=300`–`3600`, so a bare re-request (no cache-buster)
  can serve a stale copy for far longer. Cache-busting fixes that one;
  only waiting fixes propagation.
- **For an HTTP status, use `curl -s -o /dev/null -w "%{http_code}"`.**
  With `curl -sI` the proxy's CONNECT tunnel prepends `HTTP/1.1 200
  Connection Established`, so the first `HTTP/...` line is not the
  response's and a `301` reads as `200`. `-sI` is still fine when you want
  the headers themselves — print *every* `^HTTP` line plus `location:` and
  read them, e.g. `curl -sI "$url" | grep -iE "^HTTP/|^location:"`. It's
  `head -1` / `grep -m1` that does the damage, not `-sI`.
