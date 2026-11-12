---
paths:
  - "src/assets/**"
  - "public/**"
  - "scripts/build-icons.mjs"
---

# Client assets and icons

- Files in `src/assets/` are inline client assets held in template literals,
  and their escapes belong to the shipped string. Edit content, never
  framing, and verify the bytes that ship, not the syntax of the file.
- The CSP publishes SHA-256 digests of `HOME_SCRIPT`, `PUSH_CLIENT_SCRIPT`
  and `NEWS_ADMIN_SCRIPT`, and `/sw.js` is `SW_SCRIPT` verbatim.
- `public/` holds the binary icons and the `og:image`, written by
  `node scripts/build-icons.mjs`. Never hand-edit them; `test-icons` checks
  them against the script. They are served by Workers static assets with
  `run_worker_first: true`.
- No icon is an SVG.
