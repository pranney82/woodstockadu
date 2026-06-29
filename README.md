# Woodstock ADU — website + lead backend

Static marketing site for **woodstockadu.com** with a live eligibility checker
(City of Woodstock GIS), an instant pricing configurator, and a lead-capture
backend running on **Cloudflare Pages Functions + D1**.

```
.
├── index.html              # the site (single file)
├── robots.txt
├── sitemap.xml
├── functions/
│   └── api/
│       └── lead.js         # POST /api/lead  → stores lead in D1, emails via Resend
├── schema.sql              # D1 table definition
├── wrangler.toml           # Cloudflare config (D1 binding, vars)
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
2. Pick the repo. Build settings: **Framework preset: None**, **Build command: (empty)**,
   **Build output directory: `/`** (the site is static; Functions are auto-detected
   from the `functions/` folder).
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

## 4. (Optional) Email notifications via Resend

Lead storage works without this. To also get an email per lead:

1. Create a free [Resend](https://resend.com) account and **verify woodstockadu.com**
   as a sending domain (add the DNS records they give you).
2. Set the values:
   - In `wrangler.toml` `[vars]`: `LEAD_TO` (where you want leads) and `LEAD_FROM`
     (a verified address like `leads@woodstockadu.com`).
   - The API key as a **secret**:
     ```bash
     wrangler pages secret put RESEND_API_KEY
     ```
     (or Pages → Settings → Environment variables → add `RESEND_API_KEY`, encrypted).

## 5. Local development

```bash
wrangler pages dev .
```

Runs the site and `/api/lead` locally. Put local secrets in a `.dev.vars` file
(git-ignored): `RESEND_API_KEY=...`.

---

## Things still to wire before launch

- **Stripe deposit** — in `index.html`, set `data-stripe` on `#reserveBtn` to a real
  Stripe Payment Link for the $1,000 refundable deposit.
- **Real pricing** — replace the placeholder `base` prices in the `PLANS` array near
  the bottom of `index.html` with your true per-plan costs.
- **NAP + license #** — update phone, email, address, and GA license number in the
  footer and the JSON-LD `<script>` blocks (consistent name/address/phone helps local SEO).
- **og-image.jpg** — add a 1200×630 share image at the site root.
- **Geocoder** — the site uses free OpenStreetMap geocoding (good for launch). For higher
  traffic, swap the `geocode()` function to Mapbox/Google and add the key.

## Notes / disclaimers

- The eligibility tool queries **public City of Woodstock GIS** layers for guidance only;
  it is not an official zoning determination. Placement, setbacks, and septic still need a
  site visit (the UI says so).
- Pricing shown is an illustrative estimate, not a quote.
