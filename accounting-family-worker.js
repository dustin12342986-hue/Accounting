/**
 * Accounting Family Worker (Cloudflare Worker + KV)
 *
 * Lets two people share one Accounting workspace. Each person signs in with
 * their own Google account in the app; the app sends its Google access token
 * here, and this Worker asks Google who that is. Only listed members of a
 * family can read or write that family's data.
 *
 * This is a SEPARATE Worker from the Anthropic proxy the other apps use, so
 * nothing about Adulting, Remembering or Businessing changes.
 *
 * Setup is in FAMILY-SETUP.md. In short: create a KV namespace, bind it to
 * this Worker as FAMILY_KV, paste this file, deploy.
 *
 * Routes (all need "Authorization: Bearer <google access token>"):
 *   GET  /families                     families you belong to
 *   POST /families          {name}     create a family (you are the first member)
 *   POST /families/:id/members {email} add a member (members only)
 *   GET  /families/:id/state           { state, version }
 *   PUT  /families/:id/state {state, baseVersion}
 *        409 + current copy if someone saved since baseVersion
 *        409 if it would replace a copy that has data with an empty one
 */

const ALLOWED_ORIGIN = "https://dustin12342986-hue.github.io";
const MAX_BYTES = 20 * 1024 * 1024; // KV values can be up to 25 MiB

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      const email = await whoIs(request);
      if (!email) return json({ error: "Sign in with Google again." }, 401);
      const url = new URL(request.url);
      const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

      if (parts[0] !== "families") return json({ error: "Not found" }, 404);

      if (parts.length === 1 && request.method === "GET") {
        const ids = (await env.FAMILY_KV.get("user:" + email, "json")) || [];
        const families = [];
        for (const id of ids) {
          const f = await env.FAMILY_KV.get("family:" + id, "json");
          if (f && f.members.includes(email)) families.push(f);
        }
        return json({ families });
      }

      if (parts.length === 1 && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const name = String(body.name || "Family").slice(0, 60);
        const fam = { id: crypto.randomUUID(), name, members: [email], createdBy: email, createdAt: Date.now() };
        await env.FAMILY_KV.put("family:" + fam.id, JSON.stringify(fam));
        await addToIndex(env, email, fam.id);
        return json(fam);
      }

      const id = parts[1];
      const fam = id ? await env.FAMILY_KV.get("family:" + id, "json") : null;
      if (!fam || !fam.members.includes(email)) return json({ error: "That family doesn't include you." }, 403);

      if (parts[2] === "members" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const add = String(body.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(add)) return json({ error: "That isn't an email address." }, 400);
        if (!fam.members.includes(add)) fam.members.push(add);
        await env.FAMILY_KV.put("family:" + id, JSON.stringify(fam));
        await addToIndex(env, add, id);
        return json(fam);
      }

      if (parts[2] === "state" && request.method === "GET") {
        const cur = (await env.FAMILY_KV.get("state:" + id, "json")) || { state: null, version: 0 };
        return json(cur);
      }

      if (parts[2] === "state" && request.method === "PUT") {
        const raw = await request.text();
        if (raw.length > MAX_BYTES) return json({ error: "That's too much data to save in one go." }, 413);
        const body = JSON.parse(raw || "{}");
        const cur = (await env.FAMILY_KV.get("state:" + id, "json")) || { state: null, version: 0 };
        if ((body.baseVersion || 0) !== cur.version) return json(cur, 409);
        const incoming = body.state || {};
        const curHas = cur.state && Array.isArray(cur.state.items) && cur.state.items.length > 0;
        const newEmpty = !Array.isArray(incoming.items) || incoming.items.length === 0;
        if (curHas && newEmpty) return json(cur, 409); // safety rail
        const next = { state: incoming, version: cur.version + 1, savedBy: email, savedAt: Date.now() };
        await env.FAMILY_KV.put("state:" + id, JSON.stringify(next));
        return json({ version: next.version, savedAt: next.savedAt });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Family sync error: " + (e && e.message ? e.message : String(e)) }, 500);
    }
  },
};

async function whoIs(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return "";
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: auth } });
  if (!r.ok) return "";
  const u = await r.json();
  if (!u || !u.email || u.email_verified === false) return "";
  return String(u.email).toLowerCase();
}

async function addToIndex(env, email, id) {
  const key = "user:" + email;
  const ids = (await env.FAMILY_KV.get(key, "json")) || [];
  if (!ids.includes(id)) ids.push(id);
  await env.FAMILY_KV.put(key, JSON.stringify(ids));
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json" }, cors()) });
}
function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
