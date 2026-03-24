require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const {
  buildSpymasterPrompt,
  generateJsonPrompt,
  SCHEMA_CODENAMES_CLUE,
} = require("../../lib/gemini");
const { clueValid } = require("../../lib/clueValidate");

function verifyRevealedMap(assignment, revealed) {
  for (const [k, r] of Object.entries(revealed)) {
    const i = parseInt(k, 10);
    if (i < 0 || i > 24) return false;
    if (assignment[i] !== r) return false;
  }
  return true;
}

function teamWordsLeft(assignment, revealed, team) {
  let n = 0;
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (assignment[i] === team) n++;
  }
  return n;
}

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
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const { token, team, revealed: revealedRaw } = body;
  if (team !== "blue" && team !== "red") {
    res.status(400).json({ error: "team must be blue or red" });
    return;
  }
  const game = verifyToken(token);
  if (!game) {
    res.status(400).json({ error: "Invalid game token" });
    return;
  }
  const { words, assignment } = game;
  const revealed = parseRevealed(revealedRaw || {});
  if (!verifyRevealedMap(assignment, revealed)) {
    res.status(400).json({ error: "Revealed state does not match game" });
    return;
  }

  if (teamWordsLeft(assignment, revealed, team) === 0) {
    res.status(200).json({ clue: "PASS", number: 0 });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error: "GEMINI_API_KEY is not configured on the server",
      hint:
        "Vercel → your project → Settings → Environment Variables → add GEMINI_API_KEY (same value as .env.local), enable Production, Save → Deployments → Redeploy. .env.local only works on your PC with vercel dev.",
    });
    return;
  }

  let lastErr = "Could not get a valid clue";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const prompt = buildSpymasterPrompt(team, words, assignment, revealed);
      const out = await generateJsonPrompt(prompt, SCHEMA_CODENAMES_CLUE);
      const clue = String(out.clue || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
      const number = parseInt(out.number, 10);
      if (clue === "PASS" && number === 0) {
        res.status(200).json({ clue: "PASS", number: 0 });
        return;
      }
      if (!/^[A-Z]{2,24}$/.test(clue)) {
        lastErr = "Invalid clue format from model";
        continue;
      }
      if (number < 1 || number > 9) {
        lastErr = "Invalid number from model";
        continue;
      }
      if (!clueValid(clue, words)) {
        lastErr = "Clue violates Codenames word rules";
        continue;
      }
      res.status(200).json({ clue, number });
      return;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  res.status(502).json({ error: lastErr });
};
