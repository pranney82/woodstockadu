/**
 * POST /api/lead  — Cloudflare Pages Function
 * Receives a lead from the site, stores it in D1, and (optionally) emails a
 * notification via Resend. Designed to fail soft: if email isn't configured,
 * the lead is still saved; if D1 isn't bound, it still tries to email.
 *
 * Bindings / secrets (set in Cloudflare dashboard or wrangler.toml):
 *   DB              -> D1 database binding (required to store leads)
 *   RESEND_API_KEY  -> secret, optional (enables email notifications)
 *   LEAD_TO         -> var, optional (where notifications go, e.g. you@woodstockadu.com)
 *   LEAD_FROM       -> var, optional (verified Resend sender, e.g. leads@woodstockadu.com)
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Honeypot: bots fill hidden "company" field. Pretend success, drop silently.
  if (data.company) return json({ ok: true });

  // Minimal validation
  const name = (data.name || "").toString().trim().slice(0, 120);
  const email = (data.email || "").toString().trim().slice(0, 200);
  const phone = (data.phone || "").toString().trim().slice(0, 40);
  if (!name || (!email && !phone)) {
    return json({ ok: false, error: "missing_contact" }, 422);
  }

  const lead = {
    created_at: new Date().toISOString(),
    intent: (data.intent || "assessment").toString().slice(0, 40),
    name,
    email,
    phone,
    address: (data.address || "").toString().slice(0, 300),
    lat: data.lat ?? null,
    lng: data.lng ?? null,
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
  if (env.RESEND_API_KEY && env.LEAD_TO && env.LEAD_FROM) {
    const subject = `New ${lead.intent} lead — ${lead.name}`;
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
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.LEAD_FROM,
          to: env.LEAD_TO,
          reply_to: lead.email || undefined,
          subject,
          text: body,
        }),
      });
    } catch (e) {
      console.error("Resend email failed", e);
    }
  }

  return json({ ok: true, stored });
}

// Optional: respond to preflight / wrong methods cleanly
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
