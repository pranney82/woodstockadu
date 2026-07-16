# Woodstock ADU — website + lead backend

Static marketing site for **woodstockadu.com** with a live eligibility checker
(City of Woodstock GIS), an instant pricing configurator, and a lead-capture
backend running on **Cloudflare Pages Functions + D1**.

```
.
├── public/                 # everything publicly served (build output dir)
│   ├── index.html          # homepage: wizard, map, pricing, lead form
│   ├── cost.html           # /cost — pricing guide
│   ├── rules.html          # /rules — zoning guide
│   ├── 404.html            # real 404s (no SPA soft-404 fallback)
│   ├── plans/              # /plans/ hub + 5 plan pages
│   ├── assets/             # site.css, site.js, plan images/PDFs
│   ├── robots.txt / sitemap.xml / favicon.svg / icons / og-image.jpg
│   └── site.webmanifest
├── functions/
│   └── api/
│       └── lead.js         # POST /api/lead  → stores lead in D1, emails via Resend
├── schema.sql              # D1 table definition (NOT publicly served)
├── wrangler.toml           # Cloudflare config (D1 binding, vars; NOT served)
└── .gitignore
```

## 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial Woodstock ADU site + lead backend"
git branch -M main
git remote add origin https://github.com/YOUR_USER/woodstockadu.git
git push -u origin main
```

## 2. Connect Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick the repo. Build settings: **Framework preset: None**, **Build command: (empty)**.
   The build output directory comes from `wrangler.toml` (`pages_build_output_dir = "public"`);
   Functions are auto-detected from the `functions/` folder.
3. Deploy. Then add your custom domain **woodstockadu.com** under the project's
   **Custom domains** tab (Cloudflare will guide DNS since the domain is on Cloudflare).

## 3. Create the leads database (D1)

```bash
npm i -g wrangler          # if you don't have it
wrangler login
wrangler d1 create woodstockadu-leads
```

Copy the printed `database_id` into `wrangler.toml`, then create the table:

```bash
wrangler d1 execute woodstockadu-leads --remote --file=./schema.sql
```

Bind D1 to the Pages project: **Pages project → Settings → Functions → D1 database
bindings → Add binding**, Variable name **`DB`**, database **woodstockadu-leads**.
(Or rely on `wrangler.toml` if you deploy via `wrangler pages deploy`.)

Redeploy. Submitting the form now writes rows to D1. View them anytime:

```bash
wrangler d1 execute woodstockadu-leads --remote \
  --command "SELECT created_at,intent,name,email,phone,plan,estimate FROM leads ORDER BY id DESC LIMIT 20"
```

## 4. Local development

```bash
wrangler pages dev
```

Runs the site and `/api/lead` locally. Put local secrets in a `.dev.vars` file
(git-ignored): `TURNSTILE_SECRET=...`.

---

## Things still to wire before launch (owner action needed)

- **Stripe deposit** — in `public/index.html`, set `data-stripe` on `#reserveBtn` to a
  real Stripe Payment Link. Until then the reserve flow honestly says "we'll email you
  a payment link" instead of promising a checkout redirect.
- **Real pricing** — confirm the `base` prices in the `PLANS` array in `public/index.html`
  (also published on /cost and the plan pages' Product schema).
- **Lead alerts** — leads are stored in D1 only (no email service by choice). Check
  them with the `wrangler d1 execute` query above, or wire a notification channel
  later (e.g. a Worker cron that pings you about new rows).
- **Turnstile** — add the widget site key on the form and set the `TURNSTILE_SECRET`
  secret; `/api/lead` starts enforcing it automatically once the secret exists.
- **Street address + GA license #** — real phone ((404) 308-3305) and email
  (peterranney@gmail.com) are live in footers and JSON-LD; street address and
  license number are still omitted — add them everywhere at once when available.
- **www subdomain** — `www.woodstockadu.com` 522s; add it as a custom domain (or
  redirect) in the Pages project.
- **Cloudflare Web Analytics** — beacon tags were removed (they carried a placeholder
  token); enable Automatic Setup in the CF dashboard or re-add tags with a real token.
- **Geocoder** — the site uses free OpenStreetMap geocoding (good for launch). For higher
  traffic, swap the `geocode()` function to Mapbox/Google and add the key.

## Notes / disclaimers

- The eligibility tool queries **public City of Woodstock GIS** layers for guidance only;
  it is not an official zoning determination. Placement, setbacks, and septic still need a
  site visit (the UI says so).
- Pricing shown is an illustrative estimate, not a quote.
