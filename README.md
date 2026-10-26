# Folio — a calm PDF reader

A static website: no server, no build step, no accounts. Visitors add their own PDFs and everything
(books, progress, highlights) is stored in *their* browser. Nothing is uploaded anywhere.

## Deploy

**Netlify (easiest):** unzip, then drag the `folio` folder onto https://app.netlify.com/drop
(or: Add new site → Deploy manually). `netlify.toml` is already set up.

**Vercel:** unzip, open a terminal in the folder, run `npx vercel --prod`
(or push the folder to GitHub and import it on vercel.com). Framework preset: **Other**, no build command, output directory `.`.

HTTPS (which both give you) is required for offline mode and secure storage. To try it locally:
`python3 -m http.server 8000` in this folder, then open http://localhost:8000.

## What's inside
- `index.html`, `css/app.css`, `js/*` — the app (plain ES modules)
- `vendor/pdfjs` — PDF.js (Apache-2.0), bundled so the site doesn't depend on a CDN
- Fonts load from Google Fonts on demand; every font has a system fallback if offline
- `sw.js` + `manifest.webmanifest` — installable and works offline after the first visit
