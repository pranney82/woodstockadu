-- Woodstock ADU — leads table (Cloudflare D1)
-- Create the DB once:   npx wrangler d1 create woodstockadu-leads
-- Then apply this file:  npx wrangler d1 execute woodstockadu-leads --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT,
  intent      TEXT,        -- 'assessment' | 'reserve'
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  zoning      TEXT,
  in_city     INTEGER,     -- 1 / 0
  plan        TEXT,
  tier        TEXT,
  addons      TEXT,
  estimate    INTEGER,
  source      TEXT,
  user_agent  TEXT,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_intent ON leads (intent);
