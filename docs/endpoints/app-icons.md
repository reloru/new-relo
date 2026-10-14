# App icons and favicons

Eight PNG/ICO files in `public/`, one visual identity: a sun behind a cloud on
brand navy. **No icon on the site is an SVG** — see "Why PNG" below.

| Path | File | Size | Used by |
|---|---|---|---|
| `/favicon.ico` | `public/favicon.ico` | 16, 32, 48 (PNG entries) | crawlers and browsers that probe the root by convention; not linked |
| `/favicon-32.png` | `public/favicon-32.png` | 32×32 | tab icon (`<link rel="icon">`); precached by the SW |
| `/icon-192.png` | `public/icon-192.png` | 192×192 | manifest `purpose: "any"`; second `<link rel="icon">`; push notification icon |
| `/icon-512.png` | `public/icon-512.png` | 512×512 | manifest `purpose: "any"` |
| `/icon-maskable-512.png` | `public/icon-maskable-512.png` | 512×512 | manifest `purpose: "maskable"` (Android adaptive icon / WebAPK) |
| `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` | `public/apple-touch-icon.png` | 180×180 | iOS probes by convention; pages carry the same bytes inline |
| `/og-image.png` | `public/og-image.png` | 512×512 | `og:image` on every page |
| `/notification-badge.png` | `public/notification-badge.png` | 96×96 | push notification `badge` |

## Serving

Workers static assets: `wrangler.jsonc` binds `./public` as `ASSETS` with
`run_worker_first: true`, so every request reaches the Worker first. The
router (`src/router.js`) hands exactly the paths in `ICON_ASSET_PATHS`
(`src/assets/icons.js`) to `env.ASSETS.fetch`, mapping
`/apple-touch-icon-precomposed.png` to `/apple-touch-icon.png` via
`ICON_ALIASES`. Anything else still falls through to the router's own 404.

- Content-type from the asset layer: `image/png`, `image/vnd.microsoft.icon`
  for the ICO.
- `cache-control: public, max-age=604800` (set by the router). Not
  `immutable`: the URLs carry no content hash, so a redrawn icon must be able
  to replace the old one within a week.
- `ETag` and conditional `GET` (304) come from the asset layer. Methods other
  than GET/HEAD get its 405.
- The fetch wrapper's security headers apply, because the response passes
  through `fetch()` like every other.
- `/favicon.svg` and `/icon.svg` no longer exist (404).

## Inline touch icon

Every page's `<head>` (via `sharedHead()` in `src/seo.js`) carries
`<link rel="apple-touch-icon" sizes="180x180" href="data:image/png;base64,…">`
with the exact bytes of `public/apple-touch-icon.png` (~3.4 KB of markup). The
constant is `APPLE_TOUCH_ICON_DATA_URI` in `src/assets/apple-touch-icon.js`,
**generated** — never hand-edited. Inline means iOS has the icon without a
second fetch on every page, including `/news?admin=`, which does not link the
manifest.

## Why PNG

- iOS Add to Home Screen does not use SVG icons. Before this setup only
  `/news?admin=` linked a touch icon; every other page offered only SVG (the
  manifest's `/icon.svg`, the SVG favicon), and iOS drew a letter tile. The
  inline PNG touch icon on every page is the fix the Patchbay project used
  for the same symptom.
- Chrome's install criteria name a 192px and a 512px icon; the manifest now
  gives both as PNG `any` icons, plus a separate maskable one.
- A combined `"any maskable"` entry is avoided: it makes platforms show the
  safe-zone-padded maskable art where they want an `any` icon.

## The art and the files

The art is defined in `scripts/build-icons.mjs` (shapes in a 512-unit square;
the favicon art in a 32-unit one), rasterized there with 8×8 supersampling
and encoded with `node:zlib`. No dependencies. Four variants:

- **Full-bleed** (`icon-maskable-512`, `apple-touch-icon`, `og-image`): opaque
  navy to every edge. iOS cuts its own shape and fills transparency black;
  preview renderers do the same. The art's farthest point is ~156 units from
  centre, inside the maskable safe zone (radius 204.8).
- **`any`** (`icon-192`, `icon-512`): a navy tile with 96-unit rounded
  corners, art scaled 1.2× about the centre.
- **Tab** (`favicon-32`, `favicon.ico`): the original favicon art, transparent
  background.
- **Badge** (`notification-badge`): a white silhouette on transparent, with a
  gap cut around the cloud. Android draws a badge from its alpha channel only.

To change an icon: edit the art in `scripts/build-icons.mjs`, run
`node scripts/build-icons.mjs`, commit `public/` and
`src/assets/apple-touch-icon.js`.

## Guard

`scripts/test-icons.mjs` (CI step **Check app icons**) fails when:

- a committed file's decoded pixels differ from the art, or the inline module
  differs from the PNG;
- the touch icon or og:image has any transparent pixel, a pixel outside the
  maskable safe zone is not solid navy, or the badge has a non-white pixel;
- the manifest loses a PNG `any` icon at 192 or 512 or the separate maskable
  icon, contains an SVG, or declares a size the file does not have;
- any page, in either language, plus the admin and error views, lacks the
  shared block exactly once, links an SVG icon, has an og:image whose
  width/height differ from the file, or links the manifest where it must not;
- the SW's notification art is not a served PNG;
- the Worker stops serving any icon path through `ASSETS` with the security
  headers, or `wrangler.jsonc` loses the binding or `run_worker_first`.

`node scripts/build-icons.mjs --check` runs only the first item.
