/**
 * Bot Imposter redemption guess via xAI Grok (separate from Gemini used elsewhere).
 * OpenAI-compatible: POST https://api.x.ai/v1/chat/completions
 */

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

function stripMarkdownFences(text) {
  let t = String(text || "").replace(/^\uFEFF/, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * @param {string} userPrompt from buildRedeemGuessPrompt
 * @returns {Promise<{ word: string, reasoning: string }>}
 */
async function grokRedeemGuess(userPrompt) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set");

  const model =
    process.env.XAI_REDEEM_MODEL ||
    process.env.XAI_MODEL ||
    "grok-3-mini";

  const system =
    "You respond with a single JSON object only (no markdown fences). Keys: \"word\" (one lowercase English noun, letters a–z only) and \"reasoning\" (brief string).";

  const baseBody = {
    model,
    temperature: 0.35,
    max_completion_tokens: 320,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };

  async function call(extra = {}) {
    const res = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ ...baseBody, ...extra }),
    });
    const raw = await res.text();
    return { ok: res.ok, status: res.status, raw };
  }

  let { ok, status, raw } = await call({
    response_format: { type: "json_object" },
  });

  if (!ok && (status === 400 || status === 422)) {
    ({ ok, status, raw } = await call({}));
  }

  if (!ok) {
    throw new Error(`xAI error ${status}: ${raw.slice(0, 280)}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`xAI invalid response body: ${e.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new Error("Empty xAI message content");
  }

  const cleaned = stripMarkdownFences(content);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`xAI JSON parse failed: ${e.message}`);
  }

  if (!parsed || typeof parsed.word !== "string") {
    throw new Error("xAI JSON missing string \"word\"");
  }

  return {
    word: parsed.word,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}

module.exports = { grokRedeemGuess };
