require("../lib/loadEnv")();

/**
 * Default chat models when XAI_MODEL is unset. Put reasoning + non-reasoning
 * fast variants first — many restricted keys allow only one of them.
 * Keys with "Restrict access" often have Chat only (no Models endpoint); see XAI_DISCOVER_MODELS.
 * For X search, use a model your key allows on POST /v1/responses (see xAI console).
 */
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

/** Same sourcing as NEWSPAPER_USER_TASK, but Spanish body + aligned glosses + English MCQs; JSON only. */
const NEWSROOM_USER_TASK = `Search the web and X in real time for the biggest **technology industry** news from roughly the last 12 hours (relative to the UTC time above). Use the same kind of coverage as a tech desk: products, platforms, AI, security, chips, major tech business moves, developer tools, etc. Summarize storylines you actually find from search — not guesses. Do not replace that with unrelated general national or local news unless your search results are clearly about a technology story.

When you are done searching and have identified the strongest distinct storylines, your **entire** final reply must be **one JSON object only** (no markdown fences, no text before or after) with this shape:
{"articles":[{"title":"Spanish headline","lines":[{"es":["token", "..."],"en":["gloss", "..."]}],"question":"English comprehension question","options":["A","B","C","D"],"correct":0}]}

Rules:
- Exactly **3** objects in "articles", each for a different major tech storyline you verified from search.
- Titles and article body in Spanish. Each "lines" entry is one line of the article: parallel arrays "es" and "en" with **equal length** (one English gloss per Spanish token; keep punctuation on the same token as in Spanish).
- "question" and "options" in English; "correct" is 0–3.
- Only state facts supported by what you retrieved; if evidence is thin, say so briefly in Spanish in the body rather than inventing launches, fines, or stock moves.`;

const NEWSROOM_INSTRUCTIONS_APPEND =
  "\n\nFINAL OUTPUT: Your last assistant message must be raw JSON only, parseable by JSON.parse, matching the user's schema. Do not wrap it in markdown code fences.";

const NEWSPAPER_TEMPERATURE = 0.2;
const NEWSPAPER_MAX_OUTPUT_TOKENS = 2500;
/** Newsroom JSON needs more room for 3 glossed articles + quizzes. */
const NEWSPAPER_MAX_OUTPUT_TOKENS_NEWSROOM = 6144;
/** Legacy chat/completions only (no x_search). */
const NEWSPAPER_MAX_TOKENS_CHAT = 2500;
const NEWSPAPER_MAX_TOKENS_CHAT_NEWSROOM = 4096;

const RESPONSES_INSTRUCTIONS =
  "You MUST use the available server-side search tools before answering — do not rely on training memory for recency.\n\n1) Use web_search to find current tech news from reputable sources within the user's timeframe.\n2) Use x_search (date range is set on the tool) to find what is trending on X about tech in that window.\n\nThen synthesize the five biggest tech stories you actually retrieved. Each article should reflect real results from search. If search returns weak or conflicting signal, say so honestly instead of inventing product launches, fines, or stock moves. Prefer topics with multiple independent mentions.";

const RESPONSES_POLL_MS = 1500;
const RESPONSES_MAX_WAIT_MS = 110_000;
/** Newsroom tries several model/tool combos; keep each Responses job shorter so the function finishes within Vercel maxDuration. */
const RESPONSES_MAX_WAIT_MS_NEWSROOM = 72_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 95_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function readJsonBody(req) {
  const fromStream = new Promise((resolve, reject) => {
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
  return Promise.race([
    fromStream,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request body read timeout")), 15_000)
    ),
  ]);
}

function tryParseNewsroomEdition(text) {
  let t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/im);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * Models often emit `"correct": "1"` or numeric tokens as strings — normalize before validation.
 * @param {unknown} a
 */
function normalizeNewsroomArticle(a) {
  if (!a || typeof a !== "object") return a;
  const copy = { ...a };
  let cor = copy.correct;
  if (typeof cor === "string" && /^\s*\d+\s*$/.test(cor)) {
    cor = parseInt(cor.trim(), 10);
  }
  copy.correct = cor;
  if (Array.isArray(copy.lines)) {
    copy.lines = copy.lines.map((ln) => {
      if (!ln || typeof ln !== "object") return ln;
      const es = Array.isArray(ln.es) ? ln.es.map((x) => String(x)) : ln.es;
      const en = Array.isArray(ln.en) ? ln.en.map((x) => String(x)) : ln.en;
      return { es, en };
    });
  }
  if (Array.isArray(copy.options)) {
    copy.options = copy.options.map((x) => String(x));
  }
  return copy;
}

function validateNewsroomArticles(obj) {
  if (!obj || typeof obj !== "object") {
    return { ok: false, error: "Root value is not an object" };
  }
  let arts = obj.articles;
  if (!Array.isArray(arts) || arts.length === 0) {
    return { ok: false, error: '"articles" must be a non-empty array' };
  }
  arts = arts.slice(0, 3);
  const out = [];
  for (let i = 0; i < arts.length; i++) {
    const a = normalizeNewsroomArticle(arts[i]);
    if (!a || typeof a !== "object") {
      return { ok: false, error: `Article ${i + 1} is not an object` };
    }
    if (typeof a.title !== "string" || !a.title.trim()) {
      return { ok: false, error: `Article ${i + 1} needs a non-empty title` };
    }
    if (!Array.isArray(a.lines) || a.lines.length === 0) {
      return { ok: false, error: `Article ${i + 1} needs lines[]` };
    }
    for (let L = 0; L < a.lines.length; L++) {
      const ln = a.lines[L];
      if (!ln || typeof ln !== "object") {
        return { ok: false, error: `Article ${i + 1} line ${L + 1} invalid` };
      }
      if (!Array.isArray(ln.es) || !Array.isArray(ln.en) || ln.es.length !== ln.en.length) {
        return { ok: false, error: `Article ${i + 1} line ${L + 1}: es and en must be equal-length arrays` };
      }
    }
    if (!Array.isArray(a.options) || a.options.length !== 4) {
      return { ok: false, error: `Article ${i + 1} needs exactly four options` };
    }
    if (typeof a.correct !== "number" || a.correct < 0 || a.correct > 3 || Math.floor(a.correct) !== a.correct) {
      return { ok: false, error: `Article ${i + 1} needs integer correct in 0..3` };
    }
    if (typeof a.question !== "string" || !a.question.trim()) {
      return { ok: false, error: `Article ${i + 1} needs a question` };
    }
    out.push(a);
  }
  return { ok: true, articles: out };
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

/**
 * @param {string} apiKey
 * @param {object} body
 * @param {{ maxWaitMs?: number, postTimeoutMs?: number, pollTimeoutMs?: number }} [opts]
 */
async function postResponsesAndPoll(apiKey, body, opts = {}) {
  const maxWait = opts.maxWaitMs ?? RESPONSES_MAX_WAIT_MS;
  const postTimeout = opts.postTimeoutMs ?? 100_000;
  const pollTimeout = opts.pollTimeoutMs ?? 55_000;

  let r;
  try {
    r = await fetchWithTimeout(
      "https://api.x.ai/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      postTimeout
    );
  } catch (e) {
    return {
      ok: false,
      status: 504,
      err: e.name === "AbortError" ? "xAI Responses request timed out" : e.message || "Responses request failed",
    };
  }

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
  while (cur.status === "in_progress" && Date.now() - start < maxWait) {
    await sleep(RESPONSES_POLL_MS);
    let gr;
    try {
      gr = await fetchWithTimeout(
        `https://api.x.ai/v1/responses/${cur.id}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        pollTimeout
      );
    } catch (e) {
      return {
        ok: false,
        status: 504,
        err: e.name === "AbortError" ? "xAI Responses poll timed out" : e.message || "Responses poll failed",
      };
    }
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
  const radioOp = String(req.query?.radio || "").trim().toLowerCase();
  if (radioOp) {
    const { dispatchRadio } = require("../lib/radioHttp");
    return dispatchRadio(req, res, radioOp);
  }

  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON body or body read timed out" });
    return;
  }
  const newsroom = Boolean(body && body.newsroom);

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
  const userMessageContent = newsroom
    ? `Current UTC time: ${nowUtc}\n\n${NEWSROOM_USER_TASK}`
    : `Current UTC time: ${nowUtc}\n\n${NEWSPAPER_USER_TASK}`;

  const responsesInstructions = newsroom
    ? RESPONSES_INSTRUCTIONS + NEWSROOM_INSTRUCTIONS_APPEND
    : RESPONSES_INSTRUCTIONS;

  const maxOutTokens = newsroom ? NEWSPAPER_MAX_OUTPUT_TOKENS_NEWSROOM : NEWSPAPER_MAX_OUTPUT_TOKENS;

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
      const modelsLoop = newsroom ? modelsToTry.slice(0, 4) : modelsToTry;
      const bundlesLoop = newsroom ? bundles.slice(0, 2) : bundles;
      const pollOpts = newsroom
        ? {
            maxWaitMs: RESPONSES_MAX_WAIT_MS_NEWSROOM,
            postTimeoutMs: 95_000,
            pollTimeoutMs: 52_000,
          }
        : {};

      for (const model of modelsLoop) {
        for (const bundle of bundlesLoop) {
          const responsesBody = {
            model,
            instructions: responsesInstructions,
            input: [{ role: "user", content: userMessageContent }],
            tools: bundle.tools,
            tool_choice: "auto",
            temperature: NEWSPAPER_TEMPERATURE,
            max_output_tokens: maxOutTokens,
            max_turns: 16,
          };

          const rr = await postResponsesAndPoll(apiKey, responsesBody, pollOpts);

          if (rr.ok) {
            if (!rr.text) {
              lastResponsesErr = `Responses OK but empty text (${bundle.label})`;
              continue;
            }
            if (newsroom) {
              try {
                const parsed = tryParseNewsroomEdition(rr.text);
                const v = validateNewsroomArticles(parsed);
                if (!v.ok) {
                  lastResponsesErr = `${bundle.label}: newsroom invalid — ${v.error}`;
                  continue;
                }
                res.status(200).json({
                  articles: v.articles,
                  model,
                  usedLiveSearch: true,
                  usedWebSearch: bundle.label.includes("web"),
                  usedXSearch: bundle.label.includes("x_search"),
                });
                return;
              } catch (e) {
                lastResponsesErr = `${bundle.label}: newsroom JSON — ${e.message || e}`;
                continue;
              }
            }
            res.status(200).json({
              content: rr.text,
              model,
              usedLiveSearch: true,
              usedWebSearch: bundle.label.includes("web"),
              usedXSearch: bundle.label.includes("x_search"),
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

    const chatModelsLoop = newsroom ? modelsToTry.slice(0, 3) : modelsToTry;
    for (const model of chatModelsLoop) {
      let xres;
      try {
        xres = await fetchWithTimeout(
          "https://api.x.ai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              temperature: NEWSPAPER_TEMPERATURE,
              max_tokens: newsroom ? NEWSPAPER_MAX_TOKENS_CHAT_NEWSROOM : NEWSPAPER_MAX_TOKENS_CHAT,
              messages: grokChatMessages,
            }),
          },
          90_000
        );
      } catch (e) {
        lastErr = e.name === "AbortError" ? "Chat completions request timed out" : e.message || "Chat request failed";
        lastStatus = 504;
        continue;
      }

      const rawText = await xres.text();
      const data = parseJsonBody(rawText);

      if (xres.ok) {
        const content = data.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          res.status(502).json({ error: "Empty response from Grok", model });
          return;
        }
        const trimmed = content.trim();
        if (newsroom) {
          try {
            const parsed = tryParseNewsroomEdition(trimmed);
            const v = validateNewsroomArticles(parsed);
            if (!v.ok) {
              res.status(502).json({
                error: `Newsroom mode: model returned invalid JSON — ${v.error}`,
                model,
                hint: "Try again, or enable Responses + live search for more reliable structured output.",
              });
              return;
            }
            res.status(200).json({
              articles: v.articles,
              model,
              usedLiveSearch: false,
              usedXSearch: false,
              usedWebSearch: false,
              notice:
                !chatOnly && lastResponsesErr
                  ? "Plain chat only: Responses + live search failed; this JSON is NOT from live web/X search."
                  : undefined,
            });
            return;
          } catch (e) {
            res.status(502).json({
              error: `Newsroom mode: could not parse JSON — ${e.message || e}`,
              model,
            });
            return;
          }
        }
        res.status(200).json({
          content: trimmed,
          model,
          usedLiveSearch: false,
          usedXSearch: false,
          usedWebSearch: false,
          notice:
            !chatOnly && lastResponsesErr
              ? "Plain chat only: Responses + live search failed for every model/tool combo (enable /v1/responses, Web Search, and X Search on your API key). This answer is NOT from live web/X."
              : undefined,
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
      tried: modelsToTry,
      hint:
        hint403 +
        discoveryNote +
        (lastResponsesErr
          ? ` Last: ${lastResponsesErr}. Enable Responses + Web Search + X Search on the key, or set XAI_NEWSPAPER_CHAT_ONLY=1 for chat-only.`
          : ""),
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Request failed" });
  }
};
