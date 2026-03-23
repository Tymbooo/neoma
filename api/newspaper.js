require("./lib/loadEnv")();

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.XAI_API_KEY) {
    res.status(503).json({
      error: "XAI_API_KEY is not configured on the server",
      hint:
        "Add XAI_API_KEY in Vercel → Environment Variables (Production) and Redeploy. Locally, add it to .env.local.",
    });
    return;
  }

  const model =
    process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning";

  const userPrompt =
    "What are the 5 biggest tech related news items of the previous 12 hours. answer with 5 shorts paragraphs";

  const nowUtc = new Date().toISOString();

  try {
    const xres = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2500,
        messages: [
          {
            role: "system",
            content:
              "You are a tech news editor. Be concise and factual. If you cannot verify items against live data for the exact 12-hour window, still give five plausible major tech stories and add one brief sentence at the end noting any time or sourcing limits.",
          },
          {
            role: "user",
            content: `Current UTC time: ${nowUtc}\n\n${userPrompt}`,
          },
        ],
      }),
    });

    const data = await xres.json().catch(() => ({}));

    if (!xres.ok) {
      const msg =
        data.error?.message ||
        data.message ||
        `xAI API error (${xres.status})`;
      res.status(502).json({ error: msg });
      return;
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      res.status(502).json({ error: "Empty response from Grok" });
      return;
    }

    res.status(200).json({ content: content.trim(), model });
  } catch (e) {
    res.status(502).json({ error: e.message || "Request failed" });
  }
};
