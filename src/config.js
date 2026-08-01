// Site-wide constants: where Crosby is, how we identify ourselves upstream, and
// the canonical origin every generated URL is built from.

export const LAT = 29.9119;
export const LON = -95.0608;

// NWS requires a descriptive User-Agent on every request.
export const NWS_HEADERS = {
  "User-Agent": "crosbynews.com",
  Accept: "application/geo+json",
};

export const KV_KEY = "weather";
export const TZ = "America/Chicago";
// Canonical origin — used for robots.txt, sitemap, canonical link, and Link
// headers so everything consolidates to the brand domain.
export const SITE = "https://crosbynews.com";
