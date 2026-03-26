require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const {
  buildBlueOperativePrompt,
  buildSchemaCodenamesGuessesExact,
  generateJsonPrompt,
  SCHEMA_CODENAMES_GUESSES,
} = require("../../lib/gemini");
const { clueValid } = require("../../lib/clueValidate");
const { teamWordsLeft, winnerFromState } = require("../../lib/codenamesRedSim");

function verifyRevealedMap(assignment, revealed) {
  for (const [k, r] of Object.entries(revealed)) {
    const i = parseInt(k, 10);
    if (i < 0 || i > 24) return false;
    if (assignment[i] !== r) return false;
  }
  return true;
}

function blueIndices(assignment) {
  const r = [];
  for (let i = 0; i < 25; i++) if (assignment[i] === "blue") r.push(i);
  return r;
}

function countUnrevealed(revealed) {
  let n = 0;
  for (let i = 0; i < 25; i++) if (!revealed[i]) n++;
  return n;
}

/** Dedupe, skip revealed/invalid; cap at maxLen. */
function normalizeOperativeGuesses(raw, revealed, maxLen) {
  const guesses = [];
  const seen = new Set();
  const arr = Array.isArray(raw) ? raw : [];
  for (const g of arr) {
    const i = parseInt(g, 10);
    if (i >= 0 && i < 25 && !seen.has(i) && !revealed[i]) {
      seen.add(i);
      guesses.push(i);
      if (guesses.length >= maxLen) break;
    }
  }
  return guesses;
}

function simulateBlueGuesses(assignment, revealed, guesses, clueNumber) {
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
    if (role !== "blue") break;
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

  const { token, revealed: revealedRaw, clue: clueRaw, number: numRaw } = body;

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

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error: "GEMINI_API_KEY is not configured on the server",
      hint:
        "Vercel → your project → Settings → Environment Variables → add GEMINI_API_KEY, enable Production, Save → Redeploy.",
    });
    return;
  }

  if (teamWordsLeft(assignment, revealed, "blue") === 0) {
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

  const clue = String(clueRaw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const number = parseInt(numRaw, 10);

  if (clue === "PASS" && number === 0) {
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

  if (!/^[A-Z]{2,24}$/.test(clue)) {
    res.status(400).json({ error: "Clue must be one English word (letters only, 2–24 chars)" });
    return;
  }
  if (!Number.isInteger(number) || number < 1 || number > 9) {
    res.status(400).json({ error: "Number must be 1–9 (or clue PASS with number 0)" });
    return;
  }
  if (!clueValid(clue, words)) {
    res.status(400).json({ error: "Clue cannot match or contain a board word (Codenames rules)" });
    return;
  }

  const bluesUnrevealed = blueIndices(assignment).filter((i) => !revealed[i]).length;
  if (number > bluesUnrevealed) {
    res.status(400).json({ error: `Number cannot exceed unrevealed blue words (${bluesUnrevealed})` });
    return;
  }

  let steps = [];
  let nextRevealed = { ...revealed };
  let gameOver = false;
  let winner = null;
  let guesses = [];

  const guessAllowance = number + 1;
  const unrevealedCount = countUnrevealed(revealed);
  const requiredLength = Math.min(guessAllowance, unrevealedCount);

  try {
    let lastCount = -1;
    for (let attempt = 0; attempt < 4; attempt++) {
      const schema =
        requiredLength > 0
          ? buildSchemaCodenamesGuessesExact(requiredLength)
          : SCHEMA_CODENAMES_GUESSES;
      const correctionNote =
        attempt > 0
          ? `FIX: Your last answer had ${lastCount} valid unrevealed guesses but the rules require EXACTLY ${requiredLength} distinct unrevealed indices in "guesses" (full tap order). Reply again with exactly ${requiredLength} integers.`
          : undefined;
      const opPrompt = buildBlueOperativePrompt(words, revealed, clue, number, {
        requiredGuessCount: requiredLength,
        correctionNote,
      });
      const opOut = await generateJsonPrompt(opPrompt, schema);
      const raw = Array.isArray(opOut.guesses) ? opOut.guesses : [];
      guesses = normalizeOperativeGuesses(raw, revealed, requiredLength);
      lastCount = guesses.length;
      if (requiredLength === 0 || guesses.length === requiredLength) break;
    }

    const sim = simulateBlueGuesses(assignment, revealed, guesses, number);
    steps = sim.steps.map((s) => ({
      index: s.index,
      role: s.role,
      word: words[s.index],
    }));
    nextRevealed = sim.revealed;

    if (sim.assassinHit) {
      gameOver = true;
      winner = "red";
    } else {
      const w = winnerFromState(assignment, nextRevealed);
      if (w) {
        gameOver = true;
        winner = w;
      }
    }
  } catch (e) {
    res.status(502).json({ error: e.message || "Blue operative failed" });
    return;
  }

  const planIncomplete =
    requiredLength > 0 && guesses.length !== requiredLength;

  res.status(200).json({
    clue,
    number,
    guessAllowance,
    plannedGuessCount: guesses.length,
    guessesPlayedCount: steps.length,
    planIncomplete,
    steps,
    revealed: nextRevealed,
    gameOver,
    winner,
  });
};
