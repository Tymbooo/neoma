require("../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../lib/state");
const { buildSpymasterPrompt, buildOperativePrompt, generateJsonPrompt } = require("../lib/gemini");
const { clueValid } = require("../lib/clueValidate");

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

function winnerFromState(assignment, revealed) {
  let blueLeft = 0;
  let redLeft = 0;
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (assignment[i] === "blue") blueLeft++;
    else if (assignment[i] === "red") redLeft++;
  }
  if (blueLeft === 0) return "blue";
  if (redLeft === 0) return "red";
  return null;
}

function redIndices(assignment) {
  const r = [];
  for (let i = 0; i < 25; i++) if (assignment[i] === "red") r.push(i);
  return r;
}

function simulateGuesses(assignment, revealed, guesses, clueNumber) {
  const maxSteps = clueNumber <= 0 ? 0 : clueNumber + 1;
  const steps = [];
  const next = { ...revealed };
  let assassinHit = false;

  for (const idx of guesses) {
    if (steps.length >= maxSteps) break;
    if (idx < 0 || idx > 24 || next[idx]) continue;
    const role = assignment[idx];
    next[idx] = role;
    steps.push({ index: idx, role, word: null });
    if (role === "assassin") {
      assassinHit = true;
      break;
    }
    if (role !== "red") break;
  }
  return { steps, revealed: next, assassinHit };
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

  const game = verifyToken(body.token);
  if (!game) {
    res.status(400).json({ error: "Invalid game token" });
    return;
  }
  const { words, assignment } = game;
  const revealed = parseRevealed(body.revealed || {});
  if (!verifyRevealedMap(assignment, revealed)) {
    res.status(400).json({ error: "Revealed state does not match game" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error: "GEMINI_API_KEY is not configured on the server",
      hint:
        "Vercel → your project → Settings → Environment Variables → add GEMINI_API_KEY (same value as .env.local), enable Production, Save → Deployments → Redeploy.",
    });
    return;
  }

  if (teamWordsLeft(assignment, revealed, "red") === 0) {
    res.status(200).json({
      clue: "PASS",
      number: 0,
      steps: [],
      revealed,
      gameOver: false,
      winner: null,
    });
    return;
  }

  let clue = "PASS";
  let number = 0;
  let lastErr = "Clue failed";

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const prompt = buildSpymasterPrompt("red", words, assignment, revealed);
      const out = await generateJsonPrompt(prompt);
      const c = String(out.clue || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
      const n = parseInt(out.number, 10);
      if (c === "PASS" && n === 0) {
        clue = "PASS";
        number = 0;
        break;
      }
      if (/^[A-Z]{2,24}$/.test(c) && n >= 1 && n <= 9 && clueValid(c, words)) {
        clue = c;
        number = n;
        break;
      }
      lastErr = "Invalid clue from model";
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  if (clue === "PASS" && number === 0) {
    res.status(200).json({
      clue,
      number: 0,
      steps: [],
      revealed,
      gameOver: false,
      winner: null,
    });
    return;
  }

  let steps = [];
  let nextRevealed = { ...revealed };
  let gameOver = false;
  let winner = null;

  try {
    const opPrompt = buildOperativePrompt(
      "red",
      words,
      revealed,
      clue,
      number,
      redIndices(assignment)
    );
    const opOut = await generateJsonPrompt(opPrompt);
    const raw = Array.isArray(opOut.guesses) ? opOut.guesses : [];
    const guesses = [];
    const seen = new Set();
    for (const g of raw) {
      const i = parseInt(g, 10);
      if (i >= 0 && i < 25 && !seen.has(i) && !revealed[i]) {
        seen.add(i);
        guesses.push(i);
      }
    }
    const sim = simulateGuesses(assignment, revealed, guesses, number);
    steps = sim.steps.map((s) => ({
      index: s.index,
      role: s.role,
      word: words[s.index],
    }));
    nextRevealed = sim.revealed;

    if (sim.assassinHit) {
      gameOver = true;
      winner = "blue";
    } else {
      const w = winnerFromState(assignment, nextRevealed);
      if (w) {
        gameOver = true;
        winner = w;
      }
    }
  } catch (e) {
    res.status(502).json({ error: e.message || "Operative failed" });
    return;
  }

  res.status(200).json({
    clue,
    number,
    steps,
    revealed: nextRevealed,
    gameOver,
    winner,
  });
};
