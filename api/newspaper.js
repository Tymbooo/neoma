require("./lib/loadEnv")();

/** Used only if /v1/language-models fails or returns no text models. */
const DEFAULT_MODEL_FALLBACKS = [
  "grok-4-1-fast-non-reasoning",
  "grok-3-mini",
  "grok-3",
];

const PREFERRED_ORDER = [
  "grok-4-1-fast-non-reasoning",
  "grok-4-1-fast-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-3-mini",
  "grok-3",
  "grok-4",
  "grok-4-latest",
  "grok-3-mini-latest",
  "grok-3-latest",
];

function parseJsonBody(rawText) {
  if (!rawText || !rawText.trim()) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    return { _unparsed: rawText };
  }
}

function xaiErrorMessage(status, data, rawText) {
  if (data?._unparsed) {
    const t = String(data._unparsed).trim().slice(0, 400);
    return t || `xAI API error (${status})`;
  }
  const e = data?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    return [e.message, e.code, e.type].filter(Boolean).join(" — ") || JSON.stringify(e);
  }
  if (data?.message) return data.message;
  if (data?.detail) return typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  const t = (rawText || "").trim().slice(0, 400);
  return t || `xAI API error (${status})`;
}

/** Model IDs this key may use for text chat, in a sensible order. */
function modelsFromLanguageList(data) {
  const models = data?.models;
  if (!Array.isArray(models) || models.length === 0) return [];

  const textModels = models.filter((m) =>
    (m.output_modalities || []).includes("text")
  );
  const allowed = new Set();
  for (const m of textModels) {
    if (m.id) allowed.add(m.id);
    for (const a of m.aliases || []) allowed.add(a);
  }

  const ordered = [];
  const add = (id) => {
    if (id && allowed.has(id) && !ordered.includes(id)) ordered.push(id);
  };
  for (const p of PREFERRED_ORDER) add(p);
  for (const m of textModels) {
    add(m.id);
    for (const a of m.aliases || []) add(a);
  }
  return ordered;
}

async function fetchChatModelCandidates(apiKey) {
  const r = await fetch("https://api.x.ai/v1/language-models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const rawText = await r.text();
  const data = parseJsonBody(rawText);
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      message: xaiErrorMessage(r.status, data, rawText),
      rawText,
    };
  }
  const ids = modelsFromLanguageList(data);
  return { ok: true, ids, rawText };
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

  let modelsToTry;
  let discovery = null;

  if (process.env.XAI_MODEL) {
    modelsToTry = [process.env.XAI_MODEL.trim()];
  } else {
    discovery = await fetchChatModelCandidates(apiKey);
    if (discovery.ok && discovery.ids.length > 0) {
      modelsToTry = discovery.ids;
    } else {
      modelsToTry = DEFAULT_MODEL_FALLBACKS;
    }
  }

  let lastErr = "";
  let lastStatus = 0;

  const hint403 =
    "403 means your xAI team or API key is not allowed to use this (see https://docs.x.ai/docs/debugging ). Fix: xAI Console → team admin grants inference access, or create a key under a team that has billing + model access. If /v1/language-models works locally but Vercel fails, confirm the same XAI_API_KEY is set for Production and redeploy.";

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

      const rawText = await xres.text();
      const data = parseJsonBody(rawText);

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
      lastErr = xaiErrorMessage(xres.status, data, rawText);

      if (xres.status === 403 || xres.status === 404) {
        continue;
      }

      res.status(502).json({
        error: lastErr,
        status: lastStatus,
        model,
        hint: lastStatus === 403 ? hint403 : undefined,
      });
      return;
    }

    const discoveryNote =
      discovery && !discovery.ok
        ? ` Model list failed (${discovery.status}): ${discovery.message}`
        : discovery && discovery.ok && discovery.ids.length === 0
          ? " Language-models returned no text models for this key."
          : "";

    res.status(502).json({
      error: lastErr || `xAI rejected all models (${lastStatus})`,
      status: lastStatus,
      tried: modelsToTry,
      hint: hint403 + discoveryNote,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Request failed" });
  }
};
