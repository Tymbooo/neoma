require("./lib/loadEnv")();

/**
 * Default chat models when XAI_MODEL is unset. Put reasoning + non-reasoning
 * fast variants first — many restricted keys allow only one of them.
 * Keys with "Restrict access" often have Chat only (no Models endpoint); see XAI_DISCOVER_MODELS.
 */
const DEFAULT_MODEL_FALLBACKS = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
  "grok-3-mini",
  "grok-3",
];

const PREFERRED_ORDER = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-3-mini",
  "grok-3",
  "grok-4",
  "grok-4-latest",
  "grok-3-mini-latest",
  "grok-3-latest",
];

const NEWSPAPER_SYSTEM_PROMPT =
  "You are a tech news editor. Be concise and honest.\n\nThis request has no live web or X access—you cannot verify what happened in the user's time window.\n\nDo NOT invent specific news (no fake launches, fines, deals, stock moves, or events presented as if they were confirmed in the last hours). Do not write wire-style headlines to fill five slots.\n\nIf you cannot substantiate five real items for that window, say so clearly in a short reply. You may mention that real headlines would need browsing/search outside this chat endpoint.";

const NEWSPAPER_USER_TASK =
  "What are the 5 biggest tech related news items of the previous 12 hours. answer with 5 shorts paragraphs";

const NEWSPAPER_TEMPERATURE = 0.2;
const NEWSPAPER_MAX_TOKENS = 2500;

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

function envTruthy(name) {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
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

  const nowUtc = new Date().toISOString();
  const userMessageContent = `Current UTC time: ${nowUtc}\n\n${NEWSPAPER_USER_TASK}`;

  const grokMessages = [
    { role: "system", content: NEWSPAPER_SYSTEM_PROMPT },
    { role: "user", content: userMessageContent },
  ];

  let modelsToTry;
  let discovery = null;

  if (process.env.XAI_MODEL) {
    modelsToTry = [process.env.XAI_MODEL.trim()];
  } else if (envTruthy("XAI_DISCOVER_MODELS")) {
    discovery = await fetchChatModelCandidates(apiKey);
    if (discovery.ok && discovery.ids.length > 0) {
      modelsToTry = discovery.ids;
    } else {
      modelsToTry = DEFAULT_MODEL_FALLBACKS;
    }
  } else {
    modelsToTry = DEFAULT_MODEL_FALLBACKS;
  }

  let lastErr = "";
  let lastStatus = 0;

  const hint403 =
    "403: Your key may use Restrict access — only checked models/endpoints work. Use XAI_MODEL set to an allowed model (e.g. grok-4-1-fast-reasoning). Listing models needs the Models endpoint enabled on the key, or set XAI_DISCOVER_MODELS=1 only after enabling it. See https://docs.x.ai/docs/debugging";

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
          temperature: NEWSPAPER_TEMPERATURE,
          max_tokens: NEWSPAPER_MAX_TOKENS,
          messages: grokMessages,
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
        res.status(200).json({
          content: content.trim(),
          model,
          grokRequest: {
            endpoint: "POST https://api.x.ai/v1/chat/completions",
            temperature: NEWSPAPER_TEMPERATURE,
            max_tokens: NEWSPAPER_MAX_TOKENS,
            messages: grokMessages,
          },
        });
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
