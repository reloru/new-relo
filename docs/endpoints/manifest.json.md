# `GET /manifest.json`

The web app manifest. Makes the site installable and names the PWA.

| | |
|---|---|
| **Source** | the `MANIFEST` object (`src/assets/icons.js`), `JSON.stringify(…, null, 2)` |
| **Content-type** | `application/manifest+json; charset=utf-8` |
| **Cache** | `public, max-age=3600` |

## Contents

`name` "Crosby News — Crosby, TX Weather", `short_name` "Crosby News",
`id`/`start_url`/`scope` all `/`, `display: standalone`, `background_color`
`#eef2f6` (matching `BASE_CSS`), `theme_color` `#0b3d61` (brand navy), `lang`
`en-US`, and one icon: `/icon.svg`, `sizes: any`, `purpose: "any maskable"`.

## Linked from every page except two

`<link rel="manifest">` is in every page's `<head>` — **except**:

1. **The `/news?admin=` view**, which links `/apple-touch-icon.png` instead. With
   a manifest present, iOS "Add to Home Screen" reads `start_url` (`/`) and pins
   the *homepage* rather than the `?admin=` URL — the web-app URL field is locked
   when a manifest is present. Dropping the tag makes iOS bookmark the actual
   admin URL as a plain Safari web clip.
2. Nothing else. `/mcp` does link it.

## Precached

`/manifest.json` is in the service worker's `PRECACHE` list.
