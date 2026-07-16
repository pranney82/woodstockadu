/**
 * POST /api/lead  — Cloudflare Pages Function
 * Receives a lead from the site and stores it in D1. Fails LOUD (500) if the
 * lead can't be recorded, so the front-end shows its email/phone fallback
 * instead of a false success message.
 *
 * View leads:
 *   npx wrangler d1 execute woodstockadu-leads --remote \
 *     --command "SELECT created_at,intent,name,email,phone,plan,estimate FROM leads ORDER BY id DESC LIMIT 20"
 *
 * Bindings / secrets (set in Cloudflare dashboard or wrangler.toml):
 *   DB               -> D1 database binding (required to store leads)
 *   TURNSTILE_SECRET -> secret, optional. When set, requests must include a
 *                       valid `turnstileToken` (add the Turnstile widget on the
 *                       form and pass its token in the payload). Until it is
 *                       set, verification is skipped so the form keeps working.
 */

const INTENTS = new Set(["assessment", "reserve"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = /^https:\/\/((www\.)?woodstockadu\.com|([a-z0-9-]+\.)?woodstockadu\.pages\.dev)$|^http:\/\/localhost(:\d+)?$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const num = (v) => (Number.isFinite(v) ? v : null);

export async function onRequestPost(context) {
  const { request, env } = context;

  // Browsers always send Origin on cross-site POSTs; block ones from other sites.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.test(origin)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Honeypot: bots fill hidden "company" field. Pretend success, drop silently.
  if (data.company) return json({ ok: true });

  // Turnstile — enforced only once TURNSTILE_SECRET is configured.
  if (env.TURNSTILE_SECRET) {
    const token = (data.turnstileToken || "").toString();
    let passed = false;
    try {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: request.headers.get("cf-connecting-ip") || undefined,
        }),
      });
      passed = r.ok && (await r.json()).success === true;
    } catch (e) {
      console.error("Turnstile verify failed", e);
    }
    if (!passed) return json({ ok: false, error: "captcha_failed" }, 403);
  }

  // Minimal validation
  const name = (data.name || "").toString().trim().slice(0, 120);
  const email = (data.email || "").toString().trim().slice(0, 200);
  const phone = (data.phone || "").toString().trim().slice(0, 40);
  if (!name || (!email && !phone)) {
    return json({ ok: false, error: "missing_contact" }, 422);
  }
  const emailValid = EMAIL_RE.test(email);
  if (email && !phone && !emailValid) {
    return json({ ok: false, error: "invalid_email" }, 422);
  }

  const rawIntent = (data.intent || "").toString();
  const lead = {
    created_at: new Date().toISOString(),
    intent: INTENTS.has(rawIntent) ? rawIntent : "assessment",
    name,
    email,
    phone,
    address: (data.address || "").toString().slice(0, 300),
    lat: num(data.lat),
    lng: num(data.lng),
    zoning: (data.zoning || "").toString().slice(0, 120),
    in_city: data.inCity ? 1 : 0,
    plan: (data.plan || "").toString().slice(0, 60),
    tier: (data.tier || "").toString().slice(0, 40),
    addons: Array.isArray(data.addons) ? data.addons.join(", ").slice(0, 300) : "",
    estimate: Number.isFinite(data.estimate) ? Math.round(data.estimate) : null,
    source: (data.source || "woodstockadu.com").toString().slice(0, 120),
    user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
    ip: request.headers.get("cf-connecting-ip") || "",
  };

  // Store in D1 — the only record of the lead, so failure is a real failure.
  try {
    await env.DB.prepare(
      `INSERT INTO leads
        (created_at,intent,name,email,phone,address,lat,lng,zoning,in_city,plan,tier,addons,estimate,source,user_agent,ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        lead.created_at, lead.intent, lead.name, lead.email, lead.phone,
        lead.address, lead.lat, lead.lng, lead.zoning, lead.in_city,
        lead.plan, lead.tier, lead.addons, lead.estimate, lead.source,
        lead.user_agent, lead.ip
      )
      .run();
  } catch (e) {
    console.error("D1 insert failed", e);
    // Tell the truth so the UI shows its email/phone fallback.
    return json({ ok: false, error: "not_recorded" }, 500);
  }

  return json({ ok: true });
}

// Non-POST methods: 204 for OPTIONS (same-origin use needs no CORS headers),
// 405 for everything else. Pages routes POST to onRequestPost directly.
export async function onRequest(context) {
  const m = context.request.method;
  if (m === "POST") return onRequestPost(context);
  if (m === "OPTIONS") return new Response(null, { status: 204 });
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
