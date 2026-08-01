// Brand and app icons, plus the web app manifest.

// Brand favicon (a small sun behind a cloud). Served as a real file at
// /favicon.ico and /favicon.svg, and inlined as a data URI in the page <head>.
export const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<circle cx='13' cy='15' r='8' fill='#f5b301'/>" +
  "<ellipse cx='19' cy='20' rx='10' ry='6' fill='#dfe7ee'/></svg>";

// App icon for the PWA manifest (/icon.svg): the favicon art on a full-bleed
// brand-navy square. Full-bleed (no rounded corners) because it's declared
// `purpose: "any maskable"` — platforms cut maskable icons to their own shape,
// and transparent corners would show through the mask. The art stays inside
// the maskable safe zone (a centered circle of 40% radius).
export const ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>" +
  "<rect width='512' height='512' fill='#0b3d61'/>" +
  "<circle cx='216' cy='240' r='92' fill='#f5b301'/>" +
  "<ellipse cx='286' cy='298' rx='118' ry='68' fill='#dfe7ee'/></svg>";

// Raster (180×180 PNG) of the same app icon, for `/apple-touch-icon.png`. iOS
// "Add to Home Screen" needs a PNG touch icon (it ignores SVG here) and can't
// read the manifest's icon on pages that don't link the manifest — notably the
// admin /news view, which drops the manifest so the bookmark keeps its ?admin=
// URL. Without this, iOS invents a generic letter tile. It's the ONE raster
// asset on the site (everything else is SVG); kept as an inline base64 constant
// so the "no separate static files" rule still holds. Rasterized from ICON_SVG.
export const APPLE_TOUCH_ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAKpklEQVR4nOzdaWwc5R3H8WcP73p3vbt21vE63s1hx0ccx8aJA9g5CCQEAoWIQKOooCqlCHGoaiktoKqifVGEioqKgKpNKRBSIELiSBNuDIaYNHGMCbFD4tjxmdgOvo9d7zm726d1lUY0f4jxMc/M/D5aWRvbUSznq5lnZp55xmhbezsDuBAjAyAgDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiAhDiCpKg6P3b+5oMPr9LusoTmWcLqFfwxlOYKBqGEoaB4MJA8FkwcC/37TPux4q3lRf8DCgKZTwQMAF6WO3ZDfsbmgs3Te4MX/rXicHepy80TealrYO25l8H8UHEeyQfrxipNbi1qKMkbY1HzWnf5yQ/7uY/kMzqPIOAz6+G3Fzb9cVZ9pD7Lp0zJk//2nK/Y1LeK/FgaKi0OnS2zO73ho7ZHcOT42M45+5Xpkf1l1ZxbTPCXFkZoc/ssN1RtyutnMe+VY7oOV5SFJ00dzBtPC5UwJCtOH9936bmnmJIacU7HMPXRt7unKVq8vYmJapYw4ti1r2bWlymUNs1k01xbi/+6J/rT2EQfTJNHjSDZKf7z24INrjiYZEmzWWZJityxtNeoTB05nanCUKnQc/KTWnh+8d1V2D5OPTqermN+7Yt7AR21erQ1BxI3DqI+/fMtHkzqvNXNy0nxOc+SD1vlMS8SN47GrD32v4DQTxiWZgyFJX9vtZpqhZ0LaXnpy+/JmJphfX3FkfXYX0wwR47jU0/vohsNMPHode2bz/sVpo0wbhIvDZIjtuKFalmOTi+EwR5+8/gDTBuHiuGvl8fnOcSawyzz9WwrbmAaIFYfLErqv/BgTHh986HVxpnZixXFfRb3dHGXCW+D0//AS4cbL006gOLwO/49Km5hCPLj6aIopwlRNoDgeXldnNipmW82vvPy8vIGpmihxZNgCNy3pYIqyfXlTkj7G1EuUOK7LO61T2oUtfli7ZuFZpl6ixHF9nkBnyi/e9bmK/LEvkhBx8JHd6gVfMQW6Nu8MY4Ker5s6IeLYuLjLZFDkaYPMlGBRxhBTKSHi2KTkjfP67NmY0yoLIWav5LsUfClrZVY/Uykh4uCnv5hiZdim894Zocgfh9koOZOFPmUeNzgSBmfC6EzoU3SJgE4a1cVG9dJ/b7NDHDNInF+uZC2SLCWStViyLIkbXXFeA2/CQE4918V8OmnMEht9NiOprbv3ZEf3ifbuk+3qGYIIEIdVtjgkW0nUWiZZS6K2Ysk66emSCYOdvxjzlBez8uK8c59vbOtq7OhubOetdNU3dzLF0t6WQ5cUtq+OpF4Xdm6Km71sBhTmePlr4v3AqK/68xNVdccPNTSHIwq44Hw+AeJImY04+D4i4twUTt0Uca7nQwc2W9Kd9pvXX85foXCE98Er+aTu+LBP6NlM58gfR59/ZldQkZLzA+57w66tCX0yk0+y2XTVpcv4KxaLVx5ueHZvlfijEwHiGJ+pOMKOK4PueyPODUwkBoN+06pS/qo93vLCm59UH2lkohIgjuleeymhN4XnbOVbC37QwQR2WVEuf7X39L34dvW+/Z+HIsJNHZL/pqZwzHB/xbTNmoklZY4u3hl03xNPSmdKkGa3rStbunZ5YV1j64hgYxH5r62EJeNoKIlNh1DalqGig1HHOqY0hdme1x67/9br1jCRCHE75M2F7Rm2EJsCfhJzLPtPAc9DTNZR51QYDQa+/Via7a05dioYFmIXI8RV2bruuWwK4obU4SXvh+fczJTvypVFux/9qWfuHCYAIeJ4p2UB+654GSP5r8cs6lkI0Jvheu63d6en2pnchIjjQOc8X/i7DDviehsvQ7KVMnXhfTz/m3tk70OIOKJxw4dtHjZJvIzRvFfUV8aEHK+b9+GwybnGsigTjN+b5J4loTPzMqL2VUy9eB9/e/gui1m2FetEiaOy1RuJTeKHiaRuUHcZE4py5t94RRmTiShx+COmnV8UXOQ3J5jeP+9XTBvu3XqNKUmeE9kC3Q751OGSsYsbloZd22LWpUwb0lMd2zbKs40UKI7+cctf6779v5yPNvxZDzAtueOmq1IsMpzcE2sJhh2fFX3rFfxoysq4eSHTEr7xWLtChouIYsXhi5ierl32zd8TS85j2pOdlcFmnXDLPj1Tt/TQmW9azlGrcciwxKVwcSSY7o69V3aN2ahvkDQZR44HW47/GAhYtu9ZH4gaLvjVqLWYac/8TJd+1teoEHSR2mO9rvvfW33BLxmifUx7AqFIPDHbt/MLGgf3RmPO0zUXGJwaQ6eY9jR1yDAbWdw4uEeqy/hp9a990hhUwFqU066tW4btpdBx8MHpba9f/cD7FbH4/3a3Bk1uOdp7EMeF7Kov2PbqxqGgeeKPSWMHdJJWVh+fEIpEqz77ks06BcTBVXdmbdx146lBJ3+vj41Z+3YwLXm18tDAyEw9DfMbKOYBgGNh0+6GvKBkKM0csEbqg3NvV+5c4knhm41fPPF3frTCZp1i4uCkhL6mK3N3Q77N6C/J8ksOsSbyz5A3qmrfPXiUyUEZu5XzDQSTH6qs2PKHrrg0pbsZFEGKxXbu+5jJRHlxTGjoMf3k8ZficZU/uuDR5/ec6ZXtKXdK2q18TefZgcFR/7oy1c76eWL32y+98ymTj4Lj4I63dYWjUkWxem5aOee5f1T9+dUPmKyUHQf3xcl2c1LSiiXZTEXeOXDkd8++zuSm+Di4mmOnhn2By4tyjQYDU7ioFHvqlXcff/HNhACLZqshDu7LltOVhxuWF2TPTVPwc+f52PPOR3ZU1jSIUAZTTRzciG98z8e1FovpkryFOsU9noOx1z6s+dnjL5wdGGHCUE8cXDyROFjfdORkW3lxvizTtb+bwVHfA0++tOut/XyfwkSis629namOXq/bVFF6x03rCxZmMYF19Q3u3PvJnv21kYjExKPOOM5ZU7rkzi1XlxUKdyzT1Nnz/N4qfl48Hhf3cS0qj2MCP9C9+/vXrCoR4nTI543tz+39SORFBM/RRBwT3C7nqpICPhy5vDg33TmrS18Mj43XnmipaWj+Z31TT/8wUwgNxXG+XK+7vCT/sqLcJYs8WXPT2AzoHx5t7jxbe6K1puHU8bYzTIE0Gsf5LGZTjsed48lY7HXneN3ZnowF7nSDYRKXJPm4gQ8t27r72rp6W7t727r62nt6/QHFXzRGHBfmSrWnp9pdTv7RkZ6awndDrlRHmt06Nh7kR54Dw74B/nFkbHDEz9/0Dalz2qIQT2oS0OCIb1COmXlCQRxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxAQhxA+hcAAAD///JZnucAAAAGSURBVAMAqe1LPWzepM0AAAAASUVORK5CYII=";

// Web app manifest (/manifest.json) — makes the site installable and names
// the PWA. `display: standalone` so an installed copy opens app-like; colors
// match the brand navy and BASE_CSS light background.
export const MANIFEST = {
  name: "Crosby News — Crosby, TX Weather",
  short_name: "Crosby News",
  description: "Live weather, alerts, water levels, local news, and school events for Crosby, Texas.",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#eef2f6",
  theme_color: "#0b3d61",
  lang: "en-US",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
};
