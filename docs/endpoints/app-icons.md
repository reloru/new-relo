# App icons and favicons

Five paths, three constants, one visual identity: a sun behind a cloud on brand
navy.

| Path(s) | Source | Content-type | Cache |
|---|---|---|---|
| `/favicon.ico`, `/favicon.svg` | `FAVICON_SVG` | `image/svg+xml; charset=utf-8` | `public, max-age=604800, immutable` |
| `/icon.svg` | `ICON_SVG` | `image/svg+xml; charset=utf-8` | `public, max-age=604800, immutable` |
| `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` | `APPLE_TOUCH_ICON_B64` decoded to bytes | `image/png` | `public, max-age=604800, immutable` |

## `/favicon.ico` serves SVG

Deliberately. Browsers and crawlers auto-request `/favicon.ico`; serving it —
as SVG, despite the extension — avoids needless 404s in crawl stats. The same
art is also inlined as a data URI in every page's `<head>`.

## `/icon.svg` is full-bleed on purpose

It is declared `purpose: "any maskable"` in the manifest, and platforms cut
maskable icons to their own shape. Rounded corners or transparency would show
through the mask, so the navy square is full-bleed and the art stays inside the
maskable safe zone (a centered circle of 40% radius).

## The one raster asset on the site

`APPLE_TOUCH_ICON_B64` is a 180×180 PNG rasterized from `ICON_SVG`, held as an
inline base64 constant so the "no separate static files" rule still holds.

It exists because iOS "Add to Home Screen" needs a PNG touch icon — it ignores
SVG here — and cannot read the manifest's icon on a page that does not link the
manifest, which is exactly the `/news?admin=` view. Without it, iOS invents a
generic letter tile.

Both `-precomposed` and plain paths are served, because older iOS looks for the
former.
