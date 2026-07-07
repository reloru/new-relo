<!--
Layout for PR bodies, codifying the Summary → Changes → Verification structure
used across PRs #48–72. Fill in what applies; delete what doesn't. The checklist
is a reminder, not a gate (CI enforces the required checks).
-->

## Summary
<!-- One or two sentences: what this changes and why. -->

## Changes
<!-- The concrete edits. Bullet points are fine. -->

## Verification
<!-- How you confirmed it works: `node --check`, local `wrangler dev` route
regression, Playwright, live curl after deploy, etc. State what you actually ran. -->

## Pre-merge checklist
- [ ] `CLAUDE.md` updated if a route, behavior, or out-of-Worker invariant changed
- [ ] `.claude/skills/` greped for anything this change makes stale (KV keys, routes, deploy steps)
- [ ] Verified against the live site (or local `wrangler dev`) — not just syntax
