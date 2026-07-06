/**
 * POST /api/lead  — Cloudflare Pages Function
 * Receives a lead from the site, stores it in D1, and (optionally) emails a
 * notification via Resend. Fails soft between channels (if email isn't
 * configured the lead is still saved), but fails LOUD if nothing could be
 * recorded at all, so the front-end can show its mailto fallback instead of
 * a false success message.
 *
 * Bindings / secrets (set in Cloudflare dashboard or wrangler.toml):
 *   DB               -> D1 database binding (required to store leads)
 *   RESEND_API_KEY   -> secret, optional (enables email notifications)
 *   LEAD_TO          -> var, optional (where notifications go, e.g. you@woodstockadu.com)
 *   LEAD_FROM        -> var, optional (verified Resend sender, e.g. leads@woodstockadu.com)
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

  // 1) Store in D1 (if bound)
  let stored = false;
  if (env.DB) {
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
      stored = true;
    } catch (e) {
      // keep going — we still try to email so a lead is never lost
      console.error("D1 insert failed", e);
    }
  }

  // 2) Email notification (if Resend configured)
  let emailed = false;
  if (env.RESEND_API_KEY && env.LEAD_TO && env.LEAD_FROM) {
    const subject = `New ${lead.intent} lead — ${lead.name.replace(/[\r\n]/g, " ")}`;
    const body = [
      `Intent:   ${lead.intent}`,
      `Name:     ${lead.name}`,
      `Email:    ${lead.email}`,
      `Phone:    ${lead.phone}`,
      `Address:  ${lead.address}`,
      `Zoning:   ${lead.zoning} (in city: ${lead.in_city ? "yes" : "no"})`,
      `Plan:     ${lead.plan}  |  Finish: ${lead.tier}`,
      `Add-ons:  ${lead.addons || "none"}`,
      `Estimate: ${lead.estimate ? "$" + lead.estimate.toLocaleString() : "—"}`,
      `Source:   ${lead.source}`,
      `When:     ${lead.created_at}`,
    ].join("\n");

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.LEAD_FROM,
          to: env.LEAD_TO,
          reply_to: emailValid ? lead.email : undefined,
          subject,
          text: body,
        }),
      });
      if (r.ok) emailed = true;
      else console.error("Resend rejected email", r.status, await r.text());
    } catch (e) {
      console.error("Resend email failed", e);
    }
  }

  // Nothing recorded anywhere → tell the truth so the UI shows its fallback.
  if (!stored && !emailed) {
    return json({ ok: false, error: "not_recorded" }, 500);
  }
  return json({ ok: true, stored, emailed });
}

// Non-POST methods: 204 for OPTIONS (same-origin use needs no CORS headers),
// 405 for everything else. Pages routes POST to onRequestPost directly.
export async function onRequest(context) {
  const m = context.request.method;
  if (m === "POST") return onRequestPost(context);
  if (m === "OPTIONS") return new Response(null, { status: 204 });
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
