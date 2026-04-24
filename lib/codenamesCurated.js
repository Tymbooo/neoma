const path = require("path");
const { clueValid } = require("./clueValidate");

const LOCAL_PATH = path.join(__dirname, "..", "data", "codenames-curated-puzzles.json");

function validatePuzzleShape(p) {
  if (!p || !Array.isArray(p.words) || p.words.length !== 25) return false;
  if (!Array.isArray(p.assignment) || p.assignment.length !== 25) return false;
  const fc = p.firstClue;
  if (!fc || typeof fc.clue !== "string") return false;
  const n = parseInt(fc.number, 10);
  if (n < 2 || n > 4) return false;
  if (!Array.isArray(fc.targetIndices) || fc.targetIndices.length !== n) return false;
  const clue = String(fc.clue)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!clueValid(clue, p.words)) return false;
  const seen = new Set();
  for (const raw of fc.targetIndices) {
    const i = parseInt(String(raw), 10);
    if (!Number.isInteger(i) || i < 0 || i > 24 || seen.has(i)) return false;
    seen.add(i);
    if (p.assignment[i] !== "blue") return false;
  }
  const counts = { blue: 0, red: 0, neutral: 0, assassin: 0 };
  for (const a of p.assignment) {
    if (counts[a] === undefined) return false;
    counts[a]++;
  }
  return counts.blue === 9 && counts.red === 8 && counts.neutral === 7 && counts.assassin === 1;
}

function pickRandomLocalPuzzle() {
  const local = require(LOCAL_PATH);
  if (!Array.isArray(local) || local.length === 0) return null;
  const row = local[Math.floor(Math.random() * local.length)];
  return validatePuzzleShape(row) ? row : null;
}

/** @returns {Promise<object|null>} normalized puzzle or null */
async function pickRandomCuratedPuzzle() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const { createClient } = require("@supabase/supabase-js");
      const sb = createClient(url, key);
      const { data, error } = await sb.from("codenames_curated_puzzles").select("*");
      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[Math.floor(Math.random() * data.length)];
        const p = normalizeDbRow(row);
        if (validatePuzzleShape(p)) return p;
      }
    } catch {
      /* fall through to local */
    }
  }
  return pickRandomLocalPuzzle();
}

function normalizeDbRow(row) {
  const words = Array.isArray(row.words) ? row.words : JSON.parse(row.words || "[]");
  const assignment = Array.isArray(row.assignment)
    ? row.assignment
    : JSON.parse(row.assignment || "[]");
  let targetIndices = row.first_clue_target_indices;
  if (typeof targetIndices === "string") targetIndices = JSON.parse(targetIndices);
  if (!Array.isArray(targetIndices)) targetIndices = [];
  const num = row.first_clue_number != null ? row.first_clue_number : null;
  return {
    words,
    assignment,
    firstClue: {
      clue: row.first_clue,
      number: num,
      targetIndices,
    },
  };
}

/**
 * @param {object} puzzle
 * @returns {{ clue: string, number: number, targetIndices: number[] }}
 */
function firstClueForSign(puzzle) {
  const fc = puzzle.firstClue;
  const clue = String(fc.clue)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const number = parseInt(String(fc.number), 10);
  const targetIndices = fc.targetIndices.map((n) => parseInt(String(n), 10));
  return { clue, number, targetIndices };
}

module.exports = {
  pickRandomCuratedPuzzle,
  firstClueForSign,
  validatePuzzleShape,
};
