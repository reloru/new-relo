# `GET /.well-known/ai-catalog.json`

The domain's AI Catalog (Agent-Card/ai-catalog spec, specVersion 1.0), which
the MCP Server Card extension uses for domain-level discovery. It has one
entry: the Server Card at `/mcp/server-card`.

| | |
|---|---|
| **Builder** | `aiCatalog()` (`src/mcp/server.js`), served by `discoveryJson()` (`src/router.js`) |
| **Content-type** | `application/ai-catalog+json` |
| **Cache, CORS, methods** | as `/mcp/server-card` (`docs/endpoints/mcp/server-card.md`) |
| **Registry** | an `ENDPOINTS` entry (`group: "optional"`), so it is in `/sitemap`, `llms.txt` and the endpoint lists |
| **Advertised by** | `rel="ai-catalog"` in `linkHeader()` (homepage `Link`), `/developers`, `README.md`, `llms.txt` |

## Body

```json
{
  "specVersion": "1.0",
  "host": { "displayName": "crosbynews.com", "identifier": "crosbynews.com", "documentationUrl": "https://crosbynews.com/developers" },
  "entries": [
    { "identifier": "urn:air:crosbynews.com:mcp:weather", "type": "application/mcp-server-card+json", "url": "https://crosbynews.com/mcp/server-card" }
  ]
}
```

The `host` object together with the well-known URI makes this a Level 2
("Discoverable") catalog. Level 3 needs signed Trust Manifests, which we do
not publish. The identifier uses the `urn:air:{publisher}:{namespace}:{name}`
form from the Server Card extension's discovery document.

`scripts/test-routes.mjs` holds the whole body to the literal above.
