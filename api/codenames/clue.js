require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const { normCodeWord } = require("../../lib/codenamesWordNorm");
const {
  buildSpymasterPrompt,
  buildClueDominanceVerifyPrompt,
  generateJsonPrompt,
  SCHEMA_CODENAMES_CLUE,
  SCHEMA_CODENAMES_CLUE_DOMINANCE,
} = require("../../lib/gemini");
const { clueValid } = require("../../lib/clueValidate");

function isRevealedEmpty(revealed) {
  return Object.keys(revealed).length === 0;
}

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

/**
 * @param {string[]} assignment
 * @param {Record<number,string>} revealed
 * @param {'blue'|'red'} team
 * @param {number} number
 * @param {string} clue
 * @param {unknown} targetIndices
 */
function validateTargetIndices(assignment, revealed, team, number, clue, targetIndices) {
  if (clue === "PASS" && number === 0) {
    if (Array.isArray(targetIndices) && targetIndices.length > 0) return { ok: false };
    return { ok: true, indices: [] };
  }
  if (!Array.isArray(targetIndices) || targetIndices.length !== number) {
    return { ok: false };
  }
  const seen = new Set();
  for (const raw of targetIndices) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i > 24) return { ok: false };
    if (seen.has(i)) return { ok: false };
    seen.add(i);
    if (revealed[i]) return { ok: false };
    if (assignment[i] !== team) return { ok: false };
  }
  return { ok: true, indices: Array.from(seen) };
}

/**
 * Preset ladder: targets are blue words (stable across shuffles). Exhausted if any target is revealed.
 * @returns {{ clue: string, number: number, indices: number[], spoilerWords: string[] } | null}
 */
function resolveOperativePresetEntry(words, assignment, revealed, entry) {
  const clue = normCodeWord(entry.clue || "");
  const number = parseInt(String(entry.number), 10);
  const targets = Array.isArray(entry.targets) ? entry.targets : [];
  if (number < 2 || number > 4 || targets.length !== number) return null;
  if (!/^[A-Z]{2,24}$/.test(clue) || !clueValid(clue, words)) return null;
  const indices = [];
  for (const tw of targets) {
    const T = normCodeWord(tw);
    let found = -1;
    for (let i = 0; i < 25; i++) {
      if (normCodeWord(words[i]) === T && assignment[i] === "blue") {
        if (found >= 0) return null;
        found = i;
      }
    }
    if (found < 0) return null;
    if (revealed[found]) return null;
    indices.push(found);
  }
  if (new Set(indices).size !== indices.length) return null;
  return { clue, number, indices, spoilerWords: indices.map((i) => words[i]) };
}

function pickFirstUsableOperativePreset(words, assignment, revealed, presetClues) {
  if (!Array.isArray(presetClues) || !presetClues.length) return null;
  for (const entry of presetClues) {
    const r = resolveOperativePresetEntry(words, assignment, revealed, entry);
    if (r) return r;
  }
  return null;
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
  const { words, assignment, firstClue, presetClues } = game;
  const revealed = parseRevealed(revealedRaw || {});
  if (!verifyRevealedMap(assignment, revealed)) {
    res.status(400).json({ error: "Revealed state does not match game" });
    return;
  }

  if (
    team === "blue" &&
    Array.isArray(presetClues) &&
    presetClues.length > 0 &&
    teamWordsLeft(assignment, revealed, team) > 0
  ) {
    const hit = pickFirstUsableOperativePreset(words, assignment, revealed, presetClues);
    if (hit) {
      res.status(200).json({
        clue: hit.clue,
        number: hit.number,
        spoilerWords: hit.spoilerWords,
        openerPreset: true,
      });
      return;
    }
  }

  if (
    team === "blue" &&
    firstClue &&
    isRevealedEmpty(revealed) &&
    teamWordsLeft(assignment, revealed, team) > 0
  ) {
    const clue = normCodeWord(firstClue.clue || "");
    const number = parseInt(firstClue.number, 10);
    if (/^[A-Z]{2,24}$/.test(clue) && number >= 2 && number <= 4 && clueValid(clue, words)) {
      const targets = validateTargetIndices(assignment, revealed, team, number, clue, firstClue.targetIndices);
      if (targets.ok) {
        const spoilerWords = targets.indices.map((i) => words[i]);
        res.status(200).json({ clue, number, spoilerWords, openerPreset: true });
        return;
      }
    }
  }

  if (teamWordsLeft(assignment, revealed, team) === 0) {
    res.status(200).json({ clue: "PASS", number: 0, spoilerWords: [] });
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
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const prompt = buildSpymasterPrompt(team, words, assignment, revealed);
      const out = await generateJsonPrompt(prompt, SCHEMA_CODENAMES_CLUE);
      const clue = normCodeWord(out.clue || "");
      const number = parseInt(out.number, 10);
      if (clue === "PASS" && number === 0) {
        res.status(200).json({ clue: "PASS", number: 0, spoilerWords: [] });
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
      const targets = validateTargetIndices(assignment, revealed, team, number, clue, out.targetIndices);
      if (!targets.ok) {
        lastErr = "Model targetIndices must match number and unrevealed team cards";
        continue;
      }
      const teamLabel = team === "blue" ? "AZUL" : "ROJO";
      const verifyPrompt = buildClueDominanceVerifyPrompt(
        words,
        assignment,
        team,
        revealed,
        clue,
        targets.indices,
        teamLabel
      );
      const dom = await generateJsonPrompt(verifyPrompt, SCHEMA_CODENAMES_CLUE_DOMINANCE);
      if (dom.ok !== true) {
        lastErr =
          "Clue failed dominance check — strongest danger word ties or beats weakest target link";
        continue;
      }
      const spoilerWords = targets.indices.map((i) => words[i]);
      res.status(200).json({ clue, number, spoilerWords });
      return;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  res.status(502).json({ error: lastErr });
};
