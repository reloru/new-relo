// Shared CSS used by every HTML page, so styling can't drift.
//
// The look is a printed bulletin: content sits on the page, sections are
// divided by rules, and colour appears only where it means something (a link,
// a status mark, a warning). No web fonts and no images: both stacks below
// resolve to fonts already on the reader's device.
export const BASE_CSS = `
  /* Three blues with three jobs, and they are not interchangeable:
       --link    coloured text (AA on --bg and --card in both themes)
       --btn     a fill that carries WHITE text, so it does not flip in dark
       --accent  decoration only: it fails AA as text on every surface
     --card is a faint tint for code and the few boxed things; the page
     itself is --bg. --ok to --quiet are the status marks: squares and left
     rules, never text, each at least 3:1 on --bg in both themes. */
  :root { color-scheme: light dark; --blue:#0b3d61; --accent:#2c7fb8; --link:#17548c; --btn:#256d9e; --bg:#fff; --card:#f5f4f1; --ink:#1b1b1b; --muted:#5c5c5c; --line:#d6d4cf; --rule:#1b1b1b; --ok:#187a40; --warn:#a67a00; --hot:#c2500f; --bad:#b5301f; --severe:#6f1fa0; --maroon:#7a1020; --info:#256d9e; --quiet:#6b6b6b; --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --card:#1f1f1f; --ink:#e9e7e2; --muted:#a3a19b; --line:#3a3936; --link:#8fc0ea; --rule:#e9e7e2; --ok:#3fae6a; --warn:#d9a514; --hot:#ee7a35; --bad:#e5604d; --severe:#b574e6; --maroon:#c2566a; --info:#5aa7dc; --quiet:#8d8d8d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; background:var(--bg); color:var(--ink); font-variant-numeric:tabular-nums; -webkit-text-size-adjust:100%; }
  h1, h2, h3 { font-family:var(--serif); line-height:1.2; }
  .topbar .skip-link { position:absolute; left:-9999px; z-index:100; background:var(--bg); color:var(--ink); padding:0.5rem 0.9rem; border:1px solid var(--rule); }
  .topbar .skip-link:focus { position:fixed; left:0; top:0; }
  .topbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:0.2rem 1.5rem; max-width:920px; margin:0 auto; padding:0.9rem 1rem 0.6rem; border-bottom:2px solid var(--rule); }
  .topbar a { color:var(--ink); text-decoration:none; }
  .topbar .brand { font-family:var(--serif); font-weight:700; font-size:1.35rem; letter-spacing:-0.01em; }
  .topbar nav { display:flex; flex-wrap:wrap; gap:0.3rem 1.1rem; align-items:baseline; font-size:0.92rem; }
  .topbar nav a { white-space:nowrap; }
  .topbar nav a:hover { text-decoration:underline; }
  .topbar nav a[aria-current="page"] { font-weight:700; }
  .topbar nav a.lang { color:var(--link); }
  .nav-links a { margin-right:1.1rem; }
  .nav-menu { display:contents; }
  .nav-menu summary { display:none; }
  .nav-links { display:contents; }
  /* Group headers and the extra links belong to the phone menu only. */
  .nav-group-label, .nav-links a.m-only { display:none; }
  /* Chromium hides a closed <details> with ::details-content
     { content-visibility:hidden }, which display:contents does not override.
     Without this line the desktop links vanish. */
  .nav-menu::details-content { content-visibility: visible; }
  /* Below 920px the row of links no longer fits the Spanish labels, so they
     fold into a menu opened by the word "Menu". */
  @media (max-width:920px) {
    .topbar { flex-wrap:nowrap; align-items:center; padding:0.35rem 1rem; position:relative; }
    .topbar .brand { font-size:1.2rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .topbar nav { gap:0 1.1rem; flex:0 0 auto; flex-wrap:nowrap; align-items:center; }
    .topbar nav .lang { order:1; }
    .topbar nav .nav-menu { order:2; }
    .nav-menu { display:block; }
    /* 2.75rem is the 44px minimum tap height; keep it in rem. */
    .nav-menu summary { display:flex; align-items:center; cursor:pointer; list-style:none; height:2.75rem; padding:0 0 0 0.2rem; font-weight:700; }
    .nav-menu summary::-webkit-details-marker { display:none; }
    .nav-menu[open] summary { text-decoration:underline; }
    .nav-links { display:none; }
    .nav-menu[open] .nav-links { display:grid; grid-template-columns:1fr 1fr; gap:0 1.5rem; position:absolute; left:0; right:0; top:100%; margin-top:2px; background:var(--bg); padding:0.4rem 1rem 1rem; border-bottom:2px solid var(--rule); z-index:10; font-size:1rem; }
    .nav-links a { white-space:normal; padding:0.5rem 0; margin-right:0; }
    .nav-menu[open] .nav-links a.m-only { display:block; }
    .nav-menu[open] .nav-links .nav-group-label { display:block; grid-column:1 / -1; font-size:0.8rem; color:var(--muted); margin-top:0.6rem; padding-top:0.5rem; border-top:1px solid var(--line); }
  }
  main { max-width:920px; margin:0 auto; padding:1rem; }
  main a { color:var(--link); text-underline-offset:0.15em; }
  h1 { font-size:1.9rem; letter-spacing:-0.01em; margin:0.6rem 0 0.4rem; }
  h2 { font-size:1.25rem; margin:1.8rem 0 0.6rem; padding-top:0.5rem; border-top:1px solid var(--rule); }
  p { max-width:70ch; }
  .lede { font-size:1.1rem; margin:0.6rem 0 0; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .card p { margin:0.5rem 0; }
  .links, .notes, .card ul { padding-left:1.2rem; margin:0.5rem 0 0; max-width:70ch; }
  .links li, .notes li, .card li { margin:0.3rem 0; }
  .note, .notes { font-size:0.9rem; color:var(--muted); }
  code { font-size:0.9em; background:var(--card); padding:0.05rem 0.25rem; }
  pre { background:var(--card); padding:0.8rem; overflow-x:auto; font-size:0.85rem; }
  .tbl-wrap { overflow-x:auto; margin-top:0.5rem; }
  .tbl { border-collapse:collapse; font-size:0.92rem; width:100%; }
  .tbl th, .tbl td { border-bottom:1px solid var(--line); padding:0.4rem 1rem 0.4rem 0; text-align:left; vertical-align:top; }
  .tbl th { border-bottom-color:var(--rule); font-weight:600; }
  .tbl .num { white-space:nowrap; }
  /* The one-line answer at the top of a status page. */
  .status { margin-top:1.2rem; padding-left:0.9rem; border-left:4px solid var(--mark,var(--quiet)); }
  .status-title { margin:0; font-family:var(--serif); font-size:1.6rem; font-weight:700; line-height:1.15; }
  .status-sub { margin:0.3rem 0 0; }
  .status-ok { --mark:var(--ok); }
  .status-alert { background:#b5301f; color:#fff; border:0; padding:0.8rem 1rem; }
  /* Current conditions: the temperature set large, the rest in plain lines. */
  .cur { display:flex; gap:1rem; align-items:flex-start; margin-top:1.1rem; }
  .cur img { flex:none; }
  .cur-temp { margin:0; font-family:var(--serif); font-size:4rem; font-weight:700; line-height:0.95; letter-spacing:-0.02em; }
  .cur-cond { margin:0.35rem 0 0; font-size:1.15rem; font-weight:600; }
  .cur-line { margin:0.15rem 0 0; }
  .cur-stamp { margin:0.4rem 0 0; font-size:0.85rem; color:var(--muted); }
  .outlook { margin:1rem 0 0; max-width:62ch; }
  .peek { list-style:none; margin:0; padding:0; }
  .peek li { display:flex; justify-content:space-between; gap:1rem; padding:0.32rem 0; border-bottom:1px solid var(--line); }
  .peek li:last-child { border-bottom:none; }
  .pk-label { color:var(--muted); flex:none; }
  .pk-val { text-align:right; }
  h3 { font-size:1.05rem; }
  .none { color:var(--muted); }
  /* A status word with a square colour mark in front of it. The word stays in
     the text colour, so the colour is never the only signal and never has to
     carry contrast as text. */
  .mark::before { content:""; display:inline-block; width:0.62em; height:0.62em; margin-right:0.45em; background:var(--mark,var(--quiet)); }
  footer { max-width:920px; margin:2.5rem auto 0; padding:0.8rem 1rem 2.5rem; font-size:0.85rem; color:var(--muted); border-top:1px solid var(--line); }
  footer a { color:inherit; }
  .footer-links { display:flex; flex-wrap:wrap; gap:0.2rem 1.1rem; margin-top:0.7rem; }
  .footer-disclaimer { margin-top:0.7rem; }
  .nws-note { font-size:0.9rem; color:var(--muted); }
`;
