require("./lib/loadEnv")();

/**
 * Default chat models when XAI_MODEL is unset. Put reasoning + non-reasoning
 * fast variants first — many restricted keys allow only one of them.
 * Keys with "Restrict access" often have Chat only (no Models endpoint); see XAI_DISCOVER_MODELS.
 * For X search, use a model your key allows on POST /v1/responses (see xAI console).
 */
/** Bumped when changing search/live behavior — shown in UI to verify deploy. */
const NEWSPAPER_API_BUILD = "search-x-web-2026-03-24";

const DEFAULT_MODEL_FALLBACKS = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
  "grok-4-0709",
  "grok-3-mini",
  "grok-3",
];

const PREFERRED_ORDER = [
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
  "grok-4-0709",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-3-mini",
  "grok-3",
  "grok-4",
  "grok-4-latest",
  "grok-3-mini-latest",
  "grok-3-latest",
];

const NEWSPAPER_USER_TASK =
  "Search the web and X in real time for the biggest technology news from roughly the last 12 hours (relative to the UTC time above). Summarize the top storylines you actually find — not guesses. Then answer in 5 concise, short articles (one per story). Mention that reporting is based on live search when you used it.";

const NEWSPAPER_TEMPERATURE = 0.2;
const NEWSPAPER_MAX_OUTPUT_TOKENS = 2500;
/** Legacy chat/completions only (no x_search). */
const NEWSPAPER_MAX_TOKENS_CHAT = 2500;

const RESPONSES_INSTRUCTIONS =
  "You MUST use the available server-side search tools before answering — do not rely on training memory for recency.\n\n1) Use web_search to find current tech news from reputable sources within the user's timeframe.\n2) Use x_search (date range is set on the tool) to find what is trending on X about tech in that window.\n\nThen synthesize the five biggest tech stories you actually retrieved. Each article should reflect real results from search. If search returns weak or conflicting signal, say so honestly instead of inventing product launches, fines, or stock moves. Prefer topics with multiple independent mentions.";

const RESPONSES_POLL_MS = 1500;
const RESPONSES_MAX_WAIT_MS = 110_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calendar days (UTC) spanning the last ~12 hours — x_search uses YYYY-MM-DD. */
function xSearchDateRange() {
  const now = new Date();
  const ago = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const ymd = (d) => d.toISOString().slice(0, 10);
  return { from_date: ymd(ago), to_date: ymd(now) };
}

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

function extractResponsesOutputText(data) {
  const out = data?.output;
  if (!Array.isArray(out)) return "";
  const parts = [];
  for (const item of out) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
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

async function postResponsesAndPoll(apiKey, body) {
  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawPost = await r.text();
  let data = parseJsonBody(rawPost);
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      data,
      rawText: rawPost,
      err: xaiErrorMessage(r.status, data, rawPost),
    };
  }

  const start = Date.now();
  let cur = data;
  while (cur.status === "in_progress" && Date.now() - start < RESPONSES_MAX_WAIT_MS) {
    await sleep(RESPONSES_POLL_MS);
    const gr = await fetch(`https://api.x.ai/v1/responses/${cur.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const t = await gr.text();
    cur = parseJsonBody(t);
    if (!gr.ok) {
      return {
        ok: false,
        status: gr.status,
        data: cur,
        rawText: t,
        err: xaiErrorMessage(gr.status, cur, t),
      };
    }
  }

  if (cur.status !== "completed" && cur.status !== "incomplete") {
    return {
      ok: false,
      status: 502,
      data: cur,
      err: cur.error?.message || `Response status: ${cur.status || "unknown"}`,
    };
  }

  const text = extractResponsesOutputText(cur);
  return { ok: true, data: cur, text };
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
      apiBuild: NEWSPAPER_API_BUILD,
      hint:
        "Add XAI_API_KEY in Vercel → Environment Variables (Production) and Redeploy. Locally, add it to .env.local.",
    });
    return;
  }

  const nowUtc = new Date().toISOString();
  const userMessageContent = `Current UTC time: ${nowUtc}\n\n${NEWSPAPER_USER_TASK}`;

  const grokChatMessages = [{ role: "user", content: userMessageContent }];

  const xDates = xSearchDateRange();
  const chatOnly = envTruthy("XAI_NEWSPAPER_CHAT_ONLY");

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
  let lastResponsesErr = "";

  const hint403 =
    "403: Your key may use Restrict access — allow Responses + Web Search + X Search (and the model). See https://docs.x.ai/docs/debugging";

  /** Try richer tool sets first, then degrade if the key disallows one tool. */
  function toolBundlesForNewspaper(dates) {
    const xTool = {
      type: "x_search",
      from_date: dates.from_date,
      to_date: dates.to_date,
    };
    const bundles = [
      {
        label: "web_search+x_search",
        tools: [{ type: "web_search" }, xTool],
      },
      { label: "x_search_only", tools: [xTool] },
      { label: "web_search_only", tools: [{ type: "web_search" }] },
    ];
    if (envTruthy("XAI_NEWSPAPER_X_ONLY")) {
      return [{ label: "x_search_only", tools: [xTool] }];
    }
    if (envTruthy("XAI_NEWSPAPER_WEB_ONLY")) {
      return [{ label: "web_search_only", tools: [{ type: "web_search" }] }];
    }
    return bundles;
  }

  try {
    if (!chatOnly) {
      const bundles = toolBundlesForNewspaper(xDates);
      for (const model of modelsToTry) {
        for (const bundle of bundles) {
          const responsesBody = {
            model,
            instructions: RESPONSES_INSTRUCTIONS,
            input: [{ role: "user", content: userMessageContent }],
            tools: bundle.tools,
            tool_choice: "auto",
            temperature: NEWSPAPER_TEMPERATURE,
            max_output_tokens: NEWSPAPER_MAX_OUTPUT_TOKENS,
            max_turns: 16,
          };

          const rr = await postResponsesAndPoll(apiKey, responsesBody);

          if (rr.ok) {
            if (!rr.text) {
              lastResponsesErr = `Responses OK but empty text (${bundle.label})`;
              continue;
            }
            const u = rr.data?.usage || {};
            res.status(200).json({
              content: rr.text,
              model,
              apiBuild: NEWSPAPER_API_BUILD,
              usedLiveSearch: true,
              searchToolBundle: bundle.label,
              usedWebSearch: bundle.label.includes("web"),
              usedXSearch: bundle.label.includes("x_search"),
              xSearchDateRange: xDates,
              grokRequest: {
                apiKind: "responses",
                endpoint: "POST https://api.x.ai/v1/responses (poll GET until completed)",
                searchToolBundle: bundle.label,
                ...responsesBody,
              },
              usage: u,
              searchCalls: {
                web: u.server_side_tool_usage_details?.web_search_calls ?? u.web_search_calls,
                x: u.server_side_tool_usage_details?.x_search_calls ?? u.x_search_calls,
              },
            });
            return;
          }

          lastResponsesErr = `${bundle.label}: ${rr.err || xaiErrorMessage(rr.status || 502, rr.data, "")}`;
          lastStatus = rr.status || lastStatus;
          if (rr.status === 403 || rr.status === 404) {
            break;
          }
          if (rr.status && rr.status !== 502) {
            lastErr = lastResponsesErr;
          }
        }
      }
    }

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
          max_tokens: NEWSPAPER_MAX_TOKENS_CHAT,
          messages: grokChatMessages,
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
          apiBuild: NEWSPAPER_API_BUILD,
          usedLiveSearch: false,
          usedXSearch: false,
          usedWebSearch: false,
          fallbackPlainChat: !chatOnly && Boolean(lastResponsesErr),
          notice:
            !chatOnly && lastResponsesErr
              ? "Plain chat only: Responses + live search failed for every model/tool combo (enable /v1/responses, Web Search, and X Search on your API key). This answer is NOT from live web/X."
              : undefined,
          grokRequest: {
            apiKind: "chat.completions",
            endpoint: "POST https://api.x.ai/v1/chat/completions",
            temperature: NEWSPAPER_TEMPERATURE,
            max_tokens: NEWSPAPER_MAX_TOKENS_CHAT,
            messages: grokChatMessages,
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
      error: lastErr || lastResponsesErr || `xAI rejected all models (${lastStatus})`,
      status: lastStatus,
      apiBuild: NEWSPAPER_API_BUILD,
      tried: modelsToTry,
      hint:
        hint403 +
        discoveryNote +
        (lastResponsesErr
          ? ` Last: ${lastResponsesErr}. Enable Responses + Web Search + X Search on the key, or set XAI_NEWSPAPER_CHAT_ONLY=1 for chat-only.`
          : ""),
    });
  } catch (e) {
    res.status(502).json({
      error: e.message || "Request failed",
      apiBuild: NEWSPAPER_API_BUILD,
    });
  }
};
