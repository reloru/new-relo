#!/bin/bash
# Cloud-environment setup script — REFERENCE COPY.
#
# The copy that actually RUNS lives in the cloud environment's UI (Settings →
# setup script), not here: a session can't write environment settings, so this
# file can't deploy itself. It's committed so the script is reviewable,
# diffable, and recoverable. **After editing this file, paste it into the
# environment UI** — otherwise the two silently diverge.
#
# Installs CLI tools the environment needs but that aren't tied to this repo's
# state. Project dependencies (npm ci) deliberately live in the SessionStart
# hook (scripts/install_pkgs.sh) instead, so node_modules can't lag a stale
# setup-script cache — see CLAUDE.md.
#
# Non-fatal by design: a transient upstream failure shouldn't break the whole
# environment build. But every failure must be VISIBLE in the setup log,
# because this script only reruns when it changes, when the allowed network
# hosts change, or on ~7-day cache expiry — never on session resume. A silent
# failure would otherwise persist across days of sessions and only surface
# mid-task.
export DEBIAN_FRONTEND=noninteractive

# gh: Ubuntu 24.04 ships it in the default repos (2.45.x). Old, but this repo
# only uses `gh api` (REST) — GraphQL-backed subcommands 403 through the
# GitHub proxy regardless of version, so a newer gh would buy nothing.
(apt-get update -o DPkg::Lock::Timeout=120 \
  && apt-get install -y -o DPkg::Lock::Timeout=120 gh) >/tmp/setup-gh.log 2>&1 &
gh_pid=$!

# Keep this pin in sync with the `wrangler` devDependency in package.json.
npm install -g wrangler@4.114.0 >/tmp/setup-wrangler.log 2>&1 &
wrangler_pid=$!

# GOBIN is load-bearing: the default GOPATH/bin (/root/go/bin) is NOT on PATH
# in this image, so a plain `go install` leaves `publisher` installed but
# unreachable by name. (GOTOOLCHAIN defaults to auto, which fetches the Go
# >=1.26 the registry module requires.)
GOBIN=/usr/local/bin \
  go install github.com/modelcontextprotocol/registry/cmd/publisher@latest \
  >/tmp/setup-publisher.log 2>&1 &
publisher_pid=$!

status=0
for pair in "gh:$gh_pid" "wrangler:$wrangler_pid" "publisher:$publisher_pid"; do
  name=${pair%%:*}; pid=${pair##*:}
  if wait "$pid"; then
    echo "[setup] ok      $name"
  else
    echo "[setup] FAILED  $name (last 20 lines):"
    sed 's/^/[setup]   /' "/tmp/setup-$name.log" | tail -20
    status=1
  fi
done

# "Installed" is not the same as "runnable" — check the names actually resolve.
for cmd in gh wrangler publisher; do
  if path=$(command -v "$cmd"); then
    echo "[setup] on PATH $cmd -> $path"
  else
    echo "[setup] NOT ON PATH: $cmd"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "[setup] all tools ready"
else
  echo "[setup] completed with problems (see above)"
fi

# Non-fatal: report, don't block the environment build. Change to
# `exit $status` if a broken tool should fail the build instead.
exit 0
