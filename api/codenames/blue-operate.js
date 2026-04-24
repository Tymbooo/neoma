require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const {
  buildBlueOperativeScorePrompt,
  buildSchemaCodenamesOperativeScoresExact,
  generateJsonPrompt,
} = require("../../lib/gemini");
const { clueValid } = require("../../lib/clueValidate");
const { normCodeWord } = require("../../lib/codenamesWordNorm");
const { teamWordsLeft, outcomeAfterReveal, fullRevealPayload } = require("../../lib/codenamesRedSim");

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

/**
 * @param {unknown} raw
 * @param {Set<number>} unrevealedSet
 * @returns {{ index: number, score: number }[] | null}
 */
function parseOperativeScores(raw, unrevealedSet) {
  if (!Array.isArray(raw)) return null;
  const byIndex = new Map();
  for (const row of raw) {
    const idx = Number(row && row.index);
    let sc = Number(row && row.score);
    if (!Number.isInteger(idx) || idx < 0 || idx > 24 || !unrevealedSet.has(idx)) return null;
    if (byIndex.has(idx)) return null;
    if (!Number.isFinite(sc)) return null;
    sc = Math.max(0, Math.min(100, Math.round(sc)));
    byIndex.set(idx, sc);
  }
  for (const i of unrevealedSet) {
    if (!byIndex.has(i)) byIndex.set(i, 0);
  }
  if (byIndex.size !== unrevealedSet.size) return null;
  return Array.from(byIndex.entries()).map(([index, score]) => ({ index, score }));
}

function simulateBlueGuesses(assignment, revealed, guesses, clueNumber) {
  const maxSteps = clueNumber <= 0 ? 0 : clueNumber;
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
      winReason: null,
      operativeScores: [],
    });
    return;
  }

  const clue = normCodeWord(clueRaw || "");
  const number = parseInt(numRaw, 10);

  if (clue === "PASS" && number === 0) {
    res.status(200).json({
      clue: "PASS",
      number: 0,
      steps: [],
      revealed,
      gameOver: false,
      winner: null,
      winReason: null,
      operativeScores: [],
    });
    return;
  }

  if (!/^[A-Z]{2,24}$/.test(clue)) {
    res.status(400).json({ error: "Clue must be one word (letters only, 2–24 chars)" });
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

  const unrevealedIndices = [];
  for (let i = 0; i < 25; i++) {
    if (!revealed[i]) unrevealedIndices.push(i);
  }
  const unrevealedSet = new Set(unrevealedIndices);
  const k = unrevealedIndices.length;

  let steps = [];
  let nextRevealed = { ...revealed };
  let gameOver = false;
  let winner = null;
  let winReason = null;
  /** @type {{ index: number, score: number, word: string }[]} */
  let operativeScoresSorted = [];
  let scoresPlanIncomplete = false;

  const guessAllowance = number;

  try {
    let parsedScores = null;
    let lastCount = -1;
    for (let attempt = 0; attempt < 4; attempt++) {
      const schema = buildSchemaCodenamesOperativeScoresExact(k);
      const correctionNote =
        attempt > 0
          ? `FIX: Your last "scores" array had ${lastCount} valid entries but must have EXACTLY ${k} objects — one per unrevealed index (${[...unrevealedSet].sort((a, b) => a - b).join(", ")}), each index once, scores 0–100.`
          : undefined;
      const opPrompt = buildBlueOperativeScorePrompt(words, revealed, clue, number, unrevealedIndices, {
        correctionNote,
      });
      const opOut = await generateJsonPrompt(opPrompt, schema);
      const raw = Array.isArray(opOut.scores) ? opOut.scores : [];
      parsedScores = parseOperativeScores(raw, unrevealedSet);
      lastCount = Array.isArray(raw) ? raw.length : 0;
      if (parsedScores && parsedScores.length === k) break;
    }

    if (!parsedScores || parsedScores.length !== k) {
      scoresPlanIncomplete = true;
      parsedScores = unrevealedIndices.map((index) => ({ index, score: 0 }));
    }

    const sorted = [...parsedScores].sort((a, b) => b.score - a.score || a.index - b.index);
    const orderedIndices = sorted.map((e) => e.index);
    const scoreByIndex = new Map(sorted.map((e) => [e.index, e.score]));

    const sim = simulateBlueGuesses(assignment, revealed, orderedIndices, number);
    steps = sim.steps.map((s) => ({
      index: s.index,
      role: s.role,
      word: words[s.index],
      score: scoreByIndex.get(s.index) ?? null,
    }));
    nextRevealed = sim.revealed;

    operativeScoresSorted = sorted.map((e) => ({
      index: e.index,
      score: e.score,
      word: words[e.index],
    }));

    if (sim.assassinHit) {
      const o = outcomeAfterReveal(assignment, nextRevealed, { assassinRevealedBy: "blue" });
      gameOver = o.gameOver;
      winner = o.winner;
      winReason = o.winReason;
    } else {
      const o = outcomeAfterReveal(assignment, nextRevealed);
      gameOver = o.gameOver;
      winner = o.winner;
      winReason = o.winReason;
    }
  } catch (e) {
    res.status(502).json({ error: e.message || "Blue operative failed" });
    return;
  }

  res.status(200).json({
    clue,
    number,
    guessAllowance,
    plannedGuessCount: k,
    guessesPlayedCount: steps.length,
    planIncomplete: scoresPlanIncomplete,
    steps,
    operativeScores: operativeScoresSorted,
    revealed: nextRevealed,
    gameOver,
    winner,
    winReason,
    fullReveal: gameOver ? fullRevealPayload(assignment) : undefined,
  });
};
