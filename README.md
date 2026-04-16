# The One Talk Workshop — Landing Page

Static landing page for **The One Talk Workshop** with Eric Edmeades, sold under
the Speaker Nation brand. Deployed to Vercel at
[onetalk.ericedmeades.com](https://onetalk.ericedmeades.com).

Built with plain HTML + CSS + a tiny bit of JS. Vite is used only as a dev
server and build tool — no framework, no component system, nothing runtime.

---

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

To test analytics locally, create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
# edit .env.local — set VITE_GA_MEASUREMENT_ID and/or VITE_META_PIXEL_ID
npm run dev
```

With neither env var set, nothing loads from Google or Meta and the page stays
private.

---

## Production build

```bash
npm run build      # outputs to ./dist
npm run preview    # serves ./dist locally on http://localhost:4173
```

Use `npm run preview` to smoke-test the production bundle before pushing.

---

## Project layout

```
onetalk-landing/
├── index.html              # page markup (copy, structure — do not refactor)
├── src/
│   ├── styles.css          # all styles (extracted from index.html)
│   ├── analytics.js        # GA4 + Meta Pixel + CTA tracking, all grouped here
│   └── main.js             # entrypoint, calls initAnalytics() on DOM ready
├── public/
│   └── assets/             # brand assets (logos, favicon, photos)
├── vercel.json             # build + headers config for Vercel
├── .env.example            # env var template
└── .gitignore
```

---

## Deploying to Vercel

### Option A — Git-integrated (recommended)

1. Push the repo to GitHub with `main` as the default branch.
2. In Vercel → *Add New Project* → import the GitHub repo.
3. Vercel will auto-detect Vite and use the `buildCommand` / `outputDirectory`
   from `vercel.json`.
4. Set environment variables (Project → Settings → Environment Variables):
   - `VITE_GA_MEASUREMENT_ID` — your GA4 measurement ID (optional)
   - `VITE_META_PIXEL_ID` — Meta Pixel ID (optional; Speaker Nation pixel is
     `515848329126231`)
5. Trigger a deploy. The first push to `main` promotes to production; every
   PR gets its own preview URL automatically.

### Option B — Vercel CLI (manual)

```bash
npm i -g vercel
vercel login
vercel          # first run links the local project → a preview deployment
vercel --prod   # promotes to production
```

### Custom domain (onetalk.ericedmeades.com)

1. Vercel → Project → *Settings* → *Domains* → Add `onetalk.ericedmeades.com`.
2. Vercel will show the required DNS record (typically a CNAME target like
   `cname.vercel-dns.com`). **Copy the exact value Vercel gives you — don't
   hardcode it from memory.**
3. At Cloudflare (DNS for `ericedmeades.com`): add a CNAME record:
   - **Type**: `CNAME`
   - **Name**: `onetalk`
   - **Target**: the value from step 2
   - **Proxy status**: DNS only (grey cloud) — Vercel handles SSL itself
4. Back in Vercel, wait for the domain check to go green and SSL to provision
   (usually < 2 minutes).

### Branch → environment mapping

- `main` → production (auto-deploy)
- Any other branch → preview deployment per push
- PRs → preview deployment with a comment on the PR

---

## What's wired, what's not

| Feature | Status |
|---|---|
| HTML, CSS, responsive layout | ✅ Done (ported from design reference verbatim) |
| Brand assets (logos, favicon, photos) | ✅ Local in `public/assets/` |
| SEO meta tags (title, description, canonical) | ✅ Done |
| OpenGraph + Twitter cards | ✅ Meta tags in place; **`og-share.png` placeholder — produce 1200×630 image and drop at `public/assets/og-share.png`** |
| Accessibility (heading outline, focus states, alt text) | ✅ Done |
| GA4 tracking | ✅ Code in place, gated on `VITE_GA_MEASUREMENT_ID` |
| Meta Pixel | ✅ Code in place, gated on `VITE_META_PIXEL_ID` |
| CTA click tracking | ✅ Fires `cta_click` with section label (nav, hero, offer, final_cta) |
| Checkout CTAs | ⏳ Currently in-page scroll anchors; real checkout URL to be wired post-publish |

---

## Before launch — punch list

- [ ] Produce real `og-share.png` (1200×630) and place at `public/assets/og-share.png`
- [ ] Set `VITE_GA_MEASUREMENT_ID` in Vercel (production + preview)
- [ ] Confirm/set `VITE_META_PIXEL_ID` in Vercel
- [ ] Wire all `Reserve My Seat` CTAs to the real checkout URL
- [ ] Add `onetalk.ericedmeades.com` as a custom domain in Vercel + CNAME at Cloudflare
- [ ] Run `npm run preview` locally and click through the page one final time
