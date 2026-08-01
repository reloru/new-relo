# `GET /.well-known/agent-skills/*`

Agent Skills discovery (agentskills.io v0.2.0). Two coupled routes.

| Path | Source | Content-type | Cache |
|---|---|---|---|
| `/.well-known/agent-skills/index.json` | `agentSkillsIndex()` | `application/json; charset=utf-8` | `public, max-age=3600` |
| `/.well-known/agent-skills/crosby-weather/SKILL.md` | `CROSBY_WEATHER_SKILL` | `text/markdown; charset=utf-8` | `public, max-age=3600` |

Both CORS `*`.

## The digest cannot drift

`index.json` lists one skill, `crosby-weather`, with a `digest` of
`"sha256:" + sha256Hex(CROSBY_WEATHER_SKILL)` — computed **at request time from
the exact constant that the other route serves**. The index and the file are
therefore incapable of disagreeing, by construction. The same trick is used for
the CSP script hashes.

## SKILL.md contents

What the skill is for, the endpoints an agent should call, and the MCP tools by
name.

**This is one of the five hand-maintained places that name the MCP tools** and
goes stale silently. The others: `llmsTxt()`, `DEVELOPERS`, `DEVELOPERS_ES`,
`README.md`.

## Not covered by `/verify-site`

The skill's route list checks `index.json` but not the `SKILL.md` it publishes a
digest for — so a regression there breaks a documented digest silently. Recorded
as finding 5 in `docs/audit/2026-07-30-state.md`.

## Advertised by

`/developers` and the `/sitemap` page.
