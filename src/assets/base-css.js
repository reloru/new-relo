// Shared CSS used by every HTML page (weather + about), so styling can't drift.
export const BASE_CSS = `
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --sun:#f5b301; --bg:#eef2f6; --card:#fff; --ink:#16222e; --muted:#5a6b7b; --line:#d8dee5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1620; --card:#1a2430; --ink:#e6ebf1; --muted:#94a3b2; --line:#2a3744; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); }
  .topbar .skip-link { position:absolute; left:-9999px; z-index:100; background:var(--card); color:var(--ink); padding:0.5rem 0.9rem; border-radius:0 0 8px 0; }
  .topbar .skip-link:focus { position:fixed; left:0; top:0; }
  .topbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.4rem 1rem; background:var(--blue); color:#fff; padding:0.6rem 1rem; }
  .topbar a { color:#fff; text-decoration:none; }
  .topbar .brand { font-weight:800; letter-spacing:0.09em; text-transform:uppercase; font-size:1rem; }
  .topbar nav { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; font-size:0.9rem; }
  .topbar nav a { opacity:0.85; white-space:nowrap; }
  .topbar nav a:hover, .topbar nav a[aria-current="page"] { opacity:1; text-decoration:underline; }
  .topbar nav a.lang { opacity:1; border:1px solid rgba(255,255,255,0.45); border-radius:6px; padding:0.02rem 0.45rem; }
  .nav-menu { display:contents; }
  .nav-menu summary { display:none; }
  .nav-links { display:contents; }
  /* Group headers and mobile-only links belong to the hamburger menu only —
     hidden on the flat desktop bar (shown in the @media block below). */
  .nav-group-label, .nav-links a.m-only { display:none; }
  /* Desktop: show the nav links inline. Modern Chromium hides closed-<details>
     content via ::details-content { content-visibility:hidden }, which
     display:contents does NOT override — without this the desktop nav vanishes. */
  .nav-menu::details-content { content-visibility: visible; }
  /* Collapse to the grouped hamburger below 920px. The full inline bar needs
     ~920px to fit the (longer) Spanish labels on one row; below that it wrapped
     to two rows on landscape phones, so the hamburger is cleaner there. */
  @media (max-width:920px) {
    .topbar { gap:0.35rem 0.6rem; padding:0.55rem 0.85rem; flex-wrap:nowrap; }
    .topbar .brand { font-size:0.88rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .topbar nav { gap:0.4rem 0.95rem; font-size:0.86rem; flex:0 0 auto; flex-wrap:nowrap; }
    .topbar nav .lang { order:1; }
    .topbar nav .nav-menu { order:2; }
    .nav-menu { display:block; position:relative; }
    /* A real 44px tap target for the hamburger, comfortably clear of Español. */
    .nav-menu summary { display:flex; align-items:center; justify-content:center; cursor:pointer; list-style:none; font-size:1.5rem; line-height:1; opacity:0.95; color:#fff; width:2.2rem; height:2.2rem; margin-right:-0.4rem; }
    .nav-menu summary::-webkit-details-marker { display:none; }
    .nav-links { display:none; }
    .nav-menu[open] .nav-links { display:flex; flex-direction:column; position:absolute; right:0; top:calc(100% + 0.5rem); background:var(--blue); padding:0.7rem 1.1rem 0.9rem; border-radius:10px; z-index:10; gap:0.15rem; min-width:13rem; box-shadow:0 6px 16px rgba(0,0,0,0.35); }
    .nav-links a { opacity:0.92; white-space:nowrap; padding:0.35rem 0; }
    .nav-links a:hover, .nav-links a[aria-current="page"] { opacity:1; text-decoration:underline; }
    .nav-menu[open] .nav-links a.m-only { display:block; }
    .nav-menu[open] .nav-links .nav-group-label { display:block; font-size:0.66rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,255,255,0.5); margin:0.55rem 0 0.05rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.14); }
  }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  h2 { font-size:1.1rem; margin:1.4rem 0 0.6rem; }
  .none { color:var(--muted); font-style:italic; }
  footer { max-width:920px; margin:1rem auto; padding:0 1rem 2rem; font-size:0.8rem; color:var(--muted); text-align:center; }
  footer a { color:inherit; }
  .footer-links { display:flex; flex-wrap:wrap; justify-content:center; gap:0.3rem 0.75rem; margin-top:0.5rem; }
  .footer-disclaimer { margin-top:0.5rem; font-size:0.75rem; }
  .nws-note { font-size:0.85rem; opacity:0.9; }
`;
