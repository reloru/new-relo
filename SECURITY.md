# Security Policy

crosbynews.com is a Cloudflare Worker serving live weather, air quality, and
local news for Crosby, Texas. It is an independent project, not affiliated with
any government agency.

## Reporting a vulnerability

Two channels, both monitored:

- **GitHub private vulnerability reporting** — use the **Report a vulnerability**
  button on this repository's [Security tab](https://github.com/reloru/new-relo/security).
  Preferred: it keeps the report private until a fix ships, and keeps the
  discussion attached to the code.
- **Email** — [security@crosbynews.com](mailto:security@crosbynews.com), the
  address published in [`/.well-known/security.txt`](https://crosbynews.com/.well-known/security.txt)
  (RFC 9116) and on [`/about`](https://crosbynews.com/about).

Please do not open a public issue for a security report.

This is a personal project maintained by one person, so response is best-effort
rather than contractual — expect an acknowledgement within about a week. Reports
that include a concrete reproduction are the most useful.

## Scope

**In scope**

- The Worker source in `src/` — the rendered pages, the public `/api/*`
  endpoints, the MCP server at `/mcp`, and the service worker.
- The admin endpoints gated on the `ADMIN_KEY` secret (`/api/news/delete`,
  `/api/news/restore`, and the `?admin=` view of `/news`).
- The Web Push subscription endpoint and the subscriber records it writes.
- The build and deploy pipeline in `.github/workflows/deploy.yml`, including
  supply-chain issues in the `wrangler` dependency tree or the pinned Actions.

**Out of scope**

- The upstream data providers themselves — NWS/api.weather.gov, EPA Envirofacts,
  AirNow, Open-Meteo, USGS, NWPS, NHC, Houston TranStar, Houston Health
  Department, Crosby ISD, and Google News. Report issues in those to their
  operators. How we *handle* their data here is in scope.
- Cloudflare platform infrastructure.
- Missing hardening with no demonstrated impact. The Worker sets HSTS, CSP,
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`, and a restrictive `Permissions-Policy` on every
  response; a scanner note that some further header is absent is not by itself a
  finding.
- Reports generated solely by automated scanners with no verified exploit path.

## What this site does not hold

There are no user accounts, no passwords, and no payment data. The only
per-person data stored is a Web Push subscription record for readers who opt in
to severe-weather alerts, which contains a browser-issued endpoint URL and its
public keys — no name, email, or location. Deleting the subscription removes it.
See [`/privacy`](https://crosbynews.com/privacy).

## Supported versions

There are no releases or version branches. The site deploys continuously from
`main`, so the deployed commit is the only supported version and fixes ship
forward rather than being backported.
