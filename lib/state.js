const crypto = require("crypto");
const WORDS = require("./words");
const { OPERATIVE_PUZZLES } = require("./codenamesOperativeSets");
const { normCodeWord } = require("./codenamesWordNorm");

function hmacSecret() {
  return (
    process.env.CODENAMES_HMAC_SECRET ||
    process.env.GEMINI_API_KEY ||
    "dev-only-change-in-production"
  );
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWords() {
  const pool = shuffle([...WORDS]);
  return pool.slice(0, 25);
}

/**
 * Operative mode: random puzzle (9 blues + 16 paired fillers), shuffled on the board;
 * non-blue cells get 8 red, 7 neutral, 1 assassin (shuffled).
 * @returns {{ words: string[], assignment: ('blue'|'red'|'neutral'|'assassin')[], presetClues: object[] }}
 */
function buildOperativeHumanBoard() {
  const puzzle = OPERATIVE_PUZZLES[Math.floor(Math.random() * OPERATIVE_PUZZLES.length)];
  const blueWords = puzzle.blues.map((w) => normCodeWord(w));
  const fillerPick = puzzle.fillers.map((w) => normCodeWord(w));
  if (new Set(blueWords).size !== 9 || new Set(fillerPick).size !== 16) {
    throw new Error("operative puzzle must have 9 distinct blues and 16 distinct fillers");
  }
  const used = new Set([...blueWords, ...fillerPick]);
  if (used.size !== 25) throw new Error("operative puzzle blues and fillers must be disjoint");

  const presetClues = puzzle.presetClues.map((p) => ({
    clue: normCodeWord(p.clue || ""),
    number: parseInt(String(p.number), 10),
    targets: (Array.isArray(p.targets) ? p.targets : []).map((t) => normCodeWord(t)),
  }));

  const words25 = shuffle([...blueWords, ...fillerPick]);
  const blueSet = new Set(blueWords);
  /** @type {('blue'|'red'|'neutral'|'assassin'|null)[]} */
  const assignment = Array(25).fill(null);
  const nonBlueIdx = [];
  for (let i = 0; i < 25; i++) {
    if (blueSet.has(words25[i])) assignment[i] = "blue";
    else nonBlueIdx.push(i);
  }
  if (nonBlueIdx.length !== 16) {
    throw new Error("operative: internal error — blue word count mismatch");
  }
  const roles = shuffle([
    ...Array(8).fill("red"),
    ...Array(7).fill("neutral"),
    "assassin",
  ]);
  for (let k = 0; k < 16; k++) {
    assignment[nonBlueIdx[k]] = roles[k];
  }
  return { words: words25, assignment, presetClues };
}

/** @returns {('blue'|'red'|'neutral'|'assassin')[]} */
function randomAssignment() {
  const shuffled = shuffle([...Array(25).keys()]);
  const a = Array(25);
  for (let i = 0; i < 9; i++) a[shuffled[i]] = "blue";
  for (let i = 0; i < 8; i++) a[shuffled[9 + i]] = "red";
  for (let i = 0; i < 7; i++) a[shuffled[17 + i]] = "neutral";
  a[shuffled[24]] = "assassin";
  return a;
}

/**
 * @param {string[]} words
 * @param {string[]} assignment
 * @param {{ firstClue?: { clue: string, number: number, targetIndices: number[] } | null, presetClues?: { clue: string, number: number, targets: string[] }[] }} [extras]
 */
function sign(words, assignment, extras) {
  const ex = extras && typeof extras === "object" ? extras : {};
  const bodyPayload = { w: words, a: assignment };
  const fc = ex.firstClue;
  if (fc && fc.clue != null) {
    const clue = normCodeWord(fc.clue);
    const number = parseInt(String(fc.number), 10);
    const targetIndices = Array.isArray(fc.targetIndices)
      ? fc.targetIndices.map((n) => parseInt(String(n), 10))
      : [];
    if (clue && clue !== "PASS" && (number < 2 || number > 4 || targetIndices.length !== number)) {
      throw new Error("Invalid curated first clue payload");
    }
    if (clue && clue !== "PASS") {
      bodyPayload.fc = { clue, number, targetIndices };
    }
  }
  if (Array.isArray(ex.presetClues) && ex.presetClues.length > 0) {
    bodyPayload.pc = ex.presetClues.map((p) => ({
      clue: normCodeWord(p.clue || ""),
      number: parseInt(String(p.number), 10),
      targets: (Array.isArray(p.targets) ? p.targets : []).map((t) => normCodeWord(t)),
    }));
  }
  const body = JSON.stringify(bodyPayload);
  const sig = crypto.createHmac("sha256", hmacSecret()).update(body).digest("hex");
  return Buffer.from(JSON.stringify({ ...bodyPayload, s: sig })).toString("base64url");
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const o = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const { w, a, s, fc, pc } = o;
    if (!Array.isArray(w) || w.length !== 25 || !Array.isArray(a) || a.length !== 25)
      return null;
    const bodyPayload = { w, a };
    if (fc && typeof fc === "object" && fc.clue) {
      bodyPayload.fc = {
        clue: normCodeWord(fc.clue),
        number: parseInt(String(fc.number), 10),
        targetIndices: Array.isArray(fc.targetIndices)
          ? fc.targetIndices.map((n) => parseInt(String(n), 10))
          : [],
      };
    }
    if (Array.isArray(pc) && pc.length > 0) {
      bodyPayload.pc = pc.map((p) => ({
        clue: normCodeWord(p.clue || ""),
        number: parseInt(String(p.number), 10),
        targets: Array.isArray(p.targets) ? p.targets.map((t) => normCodeWord(t)) : [],
      }));
    }
    const body = JSON.stringify(bodyPayload);
    const sig = crypto.createHmac("sha256", hmacSecret()).update(body).digest("hex");
    if (sig !== s) return null;
    let firstClue = null;
    if (bodyPayload.fc && bodyPayload.fc.clue && bodyPayload.fc.clue !== "PASS") {
      firstClue = bodyPayload.fc;
    }
    const presetClues =
      bodyPayload.pc && bodyPayload.pc.length ? bodyPayload.pc : null;
    return { words: w, assignment: a, firstClue, presetClues };
  } catch {
    return null;
  }
}

/** @param {Record<string,string>} revealed map index string -> role */
function parseRevealed(revealed) {
  const out = {};
  if (!revealed || typeof revealed !== "object") return out;
  for (const [k, v] of Object.entries(revealed)) {
    const i = parseInt(k, 10);
    if (i >= 0 && i < 25 && ["blue", "red", "neutral", "assassin"].includes(v)) {
      out[i] = v;
    }
  }
  return out;
}

module.exports = {
  pickWords,
  randomAssignment,
  buildOperativeHumanBoard,
  sign,
  verifyToken,
  parseRevealed,
};
