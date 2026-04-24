require("../../lib/loadEnv")();
const { createClient } = require("@supabase/supabase-js");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Public Supabase anon key + URL (GET), or wallet actions (POST + Bearer user JWT).
 */
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  if (req.method === "GET") {
    if (!url || !anonKey) {
      res.status(503).json({
        error: "Supabase is not configured",
        hint: "Add SUPABASE_URL and SUPABASE_ANON_KEY to environment variables.",
      });
      return;
    }
    res.status(200).json({ url, anonKey });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!url || !anonKey) {
    res.status(503).json({ error: "Supabase is not configured" });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!serviceKey) {
    res.status(503).json({
      error: "Rewards are not configured",
      hint: "Add SUPABASE_SERVICE_ROLE_KEY for claim and heart APIs.",
    });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);
  if (userErr || !user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const HOUR_MS = 60 * 60 * 1000;

  try {
    if (body.recordHeartLoss === true) {
      const { data: row } = await admin
        .from("profiles")
        .select("coins, heart_losses")
        .eq("id", user.id)
        .maybeSingle();

      let losses = Array.isArray(row?.heart_losses) ? row.heart_losses.map(String) : [];
      const now = Date.now();
      losses = losses.filter((ts) => {
        const t = new Date(ts).getTime();
        return !Number.isNaN(t) && now - t < HOUR_MS;
      });

      if (losses.length < 3) {
        losses.push(new Date().toISOString());
      }

      await admin.from("profiles").upsert(
        {
          id: user.id,
          heart_losses: losses,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      res.status(200).json({
        ok: true,
        coins: row?.coins ?? 0,
        heartLosses: losses,
      });
      return;
    }

    if (body.claimId != null) {
      const claimId = String(body.claimId);
      if (!UUID_RE.test(claimId)) {
        res.status(400).json({ error: "claimId must be a UUID" });
        return;
      }

      const { error: insErr } = await admin.from("reward_claims").insert({
        claim_id: claimId,
        user_id: user.id,
      });

      if (insErr) {
        if (insErr.code === "23505") {
          const { data: prof } = await admin.from("profiles").select("coins").eq("id", user.id).maybeSingle();
          res.status(200).json({ ok: true, coins: prof?.coins ?? 0, alreadyClaimed: true });
          return;
        }
        console.error("reward_claims insert", insErr);
        res.status(500).json({ error: "Could not record claim" });
        return;
      }

      const { data: prof } = await admin.from("profiles").select("coins").eq("id", user.id).maybeSingle();
      const next = (prof?.coins ?? 0) + 1;
      const { error: upErr } = await admin.from("profiles").upsert(
        {
          id: user.id,
          coins: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (upErr) {
        console.error("profiles coins upsert", upErr);
        res.status(500).json({ error: "Could not update balance" });
        return;
      }

      res.status(200).json({ ok: true, coins: next });
      return;
    }

    res.status(400).json({ error: "Unknown body; use claimId or recordHeartLoss" });
  } catch (e) {
    console.error("wallet POST", e);
    res.status(500).json({ error: "Server error" });
  }
};
