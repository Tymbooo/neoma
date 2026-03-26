require("../../lib/loadEnv")();

/**
 * Public Supabase anon key + URL for browser client (safe with RLS).
 * Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel env / .env.local
 */
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    res.status(503).json({
      error: "Supabase is not configured",
      hint: "Add SUPABASE_URL and SUPABASE_ANON_KEY to environment variables.",
    });
    return;
  }
  res.status(200).json({ url, anonKey });
};
