# Official MCP Registry (published listing)

Current expected state of the site's listing on the official MCP Registry.
Overwritten in place — no history; see `docs/README.md`.

- The `/mcp` server is **published to the official MCP Registry**
  (`registry.modelcontextprotocol.io`) as **`com.crosbynews/weather`** — a
  **remote** server (no downloadable package): `remotes: [{ type:
  "streamable-http", url: "https://crosbynews.com/mcp" }]`. `server.json`
  at the repo root is the source of truth (validated with
  `mcp-publisher validate`). Verify:
  `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.crosbynews/weather"`.
- **Bump `server.json`'s `version` and `MCP_SERVER_INFO.version`
  (`src/mcp/server.js`) in the same PR** whenever the tool set changes.
  (`/openapi.json`'s `info.version` is a separate track — it describes the
  REST API.) Bumping `server.json` does NOT publish; the listing only
  moves when someone runs the publish flow below, so a
  bumped-but-unpublished version is normal, and an unpublished version is
  skipped rather than backfilled.
- **Five hand-maintained places name the tools — update every one when
  adding a tool.** `mcpTools()` is the only generated list; these five are
  prose that goes stale silently: `CROSBY_WEATHER_SKILL` (served at
  `/.well-known/agent-skills/crosby-weather/SKILL.md`), `llmsTxt()`, the
  `MCP server` section of **both** `DEVELOPERS` and `DEVELOPERS_ES` (the
  `/developers` page), and `README.md`. Two surfaces that look like they
  belong on that list do NOT: `mcpServerCard()` derives its tool list from
  `mcpTools()` so it cannot drift, and the MCP `initialize` `instructions`
  string is prose about the data with no tool names in it. (This entry
  said "six" and counted those two until the 2026-08-01 audit;
  `src/mcp/server.js` and `src/discovery.js` had already said five.)
- **Namespace auth = DNS.** The `com.crosbynews` namespace is proven by a
  TXT record on the apex `crosbynews.com`: `v=MCPv1; k=ed25519;
  p=<base64 pubkey>` (added via the Cloudflare DNS API alongside the
  SPF/DKIM/DMARC/DNS-AID records). **Leave that TXT record in place** —
  re-publishing/updating the listing re-checks it.
- **The `publisher` CLI**: `command -v publisher` first, then if missing
  `GOBIN=/usr/local/bin go install
  github.com/modelcontextprotocol/registry/cmd/publisher@latest`.
  **`GOBIN` is required** — without it the binary lands in
  `/root/go/bin`, which is not on PATH, and the install "succeeds" while
  `which publisher` finds nothing.
- **To update the listing** (new tools, a metadata change): bump `version`
  in `server.json`, then re-auth + publish. Because the publish keypair is
  ephemeral, the flow is: `openssl genpkey -algorithm Ed25519 -out
  key.pem` → derive the pubkey (`openssl pkey -in key.pem -pubout -outform
  DER | tail -c 32 | base64`) → overwrite the `crosbynews.com` MCP TXT
  record's content with the new `v=MCPv1; k=ed25519; p=…` →
  `publisher login dns --domain crosbynews.com --private-key <hex>` →
  `publisher publish`. Notes:
  - **`xxd` is NOT installed in this environment**, so the usual
    `... | xxd -p` for the private-key hex fails with "command not
    found". Use `openssl pkey -in key.pem -outform DER | tail -c 32 | od
    -An -tx1 | tr -d ' \n'` instead (must be exactly 64 hex chars).
  - **PATCH the existing MCP TXT record by id — never bulk-write the
    apex.** The apex carries five TXT records (MCP, SPF,
    google-site-verification, apple-domain,
    openai-domain-verification); the MCP one is id
    `8f0e53d79ee64be84df930d7e46a874b`. `PATCH
    /zones/{zone}/dns_records/{id}` with just `{"content": "v=MCPv1;
    …"}` leaves the other four untouched — re-verify all five
    afterward.
  - Wait for the new key to appear in public DNS (`curl -H 'accept:
    application/dns-json'
    'https://cloudflare-dns.com/dns-query?name=crosbynews.com&type=TXT'`)
    before `publisher login dns`, which checks the record live.
  - Keep `key.pem` OUT of the repo (use a scratch dir). It's single-use:
    the next publish rotates the TXT record to a fresh pubkey anyway.
- **PulseMCP needs no separate submission** — it ingests the official
  registry automatically, so the listing propagates to `pulsemcp.com` on
  its next sync (~daily). (A manual `pulsemcp.com/submit` would only
  create a duplicate.)
- **Google Search Console**: the domain is **verified** — confirmed by the
  live `google-site-verification=…` TXT record on `crosbynews.com`
  (checked via the Cloudflare API). Sitemap submission + per-URL "Request
  indexing" (e.g. for the now-indexable `/mcp`) are account-level actions
  in the GSC UI, not visible from the repo.
