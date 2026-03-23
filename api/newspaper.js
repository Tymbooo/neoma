require("./lib/loadEnv")();

/** Models to try in order until one succeeds. Set XAI_MODEL to use only that model. */
const DEFAULT_MODEL_FALLBACKS = [
  "grok-3",
  "grok-3-mini",
  "grok-4-1-fast-non-reasoning",
];

function xaiErrorMessage(status, data) {
  const e = data?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    return e.message || e.code || JSON.stringify(e);
  }
  return data?.message || `xAI API error (${status})`;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = (process.env.XAI_API_KEY || "").trim();
  if (!apiKey) {
    res.status(503).json({
      error: "XAI_API_KEY is not configured on the server",
      hint:
        "Add XAI_API_KEY in Vercel → Environment Variables (Production) and Redeploy. Locally, add it to .env.local.",
    });
    return;
  }

  const userPrompt =
    "What are the 5 biggest tech related news items of the previous 12 hours. answer with 5 shorts paragraphs";

  const nowUtc = new Date().toISOString();

  const modelsToTry = process.env.XAI_MODEL
    ? [process.env.XAI_MODEL.trim()]
    : DEFAULT_MODEL_FALLBACKS;

  let lastErr = "";
  let lastStatus = 0;

  try {
    for (const model of modelsToTry) {
      const xres = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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

      if (xres.ok) {
        const content = data.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          res.status(502).json({ error: "Empty response from Grok", model });
          return;
        }
        res.status(200).json({ content: content.trim(), model });
        return;
      }

      lastStatus = xres.status;
      lastErr = xaiErrorMessage(xres.status, data);

      if (xres.status === 403 || xres.status === 404) {
        continue;
      }

      res.status(502).json({
        error: lastErr,
        status: lastStatus,
        model,
        hint:
          lastStatus === 403
            ? "403 often means this model is not enabled for your API key. In xAI Console → API keys, enable Chat / the model, or set XAI_MODEL to a model your team can use."
            : undefined,
      });
      return;
    }

    res.status(502).json({
      error: lastErr || `xAI rejected all models (${lastStatus})`,
      status: lastStatus,
      tried: modelsToTry,
      hint:
        "403: Open https://console.x.ai/ → your API key → ensure access to Chat Completions and at least one Grok model. Or set env XAI_MODEL to a model listed for your team (Console → Models).",
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Request failed" });
  }
};
