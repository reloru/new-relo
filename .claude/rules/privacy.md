---
paths:
  - "src/metrics.js"
  - "src/mcp/metrics.js"
  - "src/pages/privacy.js"
  - "src/discovery.js"
  - "migrations/**"
---

# Privacy and analytics

- No browser analytics script, and the CSP (`src/discovery.js`) allows no
  third-party script origin.
- Aggregate counts only: page requests in D1 `hits` (`src/metrics.js`) and
  MCP calls in KV (`src/mcp/metrics.js`). Never an address, user agent,
  referring URL, search term or query string.
- `/privacy` describes both counters in both languages, and
  `test-site-metrics` holds the code to that text. Change the code and the
  text together.
- Reports: `/api/site-usage` and `/api/mcp-usage`
  (`?key=<ADMIN_KEY>&format=txt`). Detail: `docs/ops/analytics.md`.
