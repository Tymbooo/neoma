#!/usr/bin/env node
/** Validate data/codenames-curated-puzzles.json */
const fs = require("fs");
const path = require("path");
const { clueValid } = require("../lib/clueValidate");
const wordsCore = require("../lib/wordsCore");
const coreSet = new Set(wordsCore);

const p = path.join(__dirname, "..", "data", "codenames-curated-puzzles.json");
const puzzles = JSON.parse(fs.readFileSync(p, "utf8"));

function validateTargetIndices(assignment, revealed, team, number, targetIndices) {
  if (!Array.isArray(targetIndices) || targetIndices.length !== number) return false;
  const seen = new Set();
  for (const raw of targetIndices) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i > 24) return false;
    if (seen.has(i)) return false;
    seen.add(i);
    if (revealed[i]) return false;
    if (assignment[i] !== team) return false;
  }
  return true;
}

let ok = true;
puzzles.forEach((puz, idx) => {
  const { words, assignment, firstClue } = puz;
  if (!Array.isArray(words) || words.length !== 25) {
    console.error(`Puzzle ${idx}: bad words length`);
    ok = false;
    return;
  }
  const set = new Set(words.map((w) => String(w).toUpperCase()));
  if (set.size !== 25) {
    console.error(`Puzzle ${idx}: duplicate words`);
    ok = false;
  }
  for (const w of words) {
    if (!coreSet.has(String(w).toUpperCase())) {
      console.error(`Puzzle ${idx}: word not in wordsCore: ${w}`);
      ok = false;
    }
  }
  const counts = { blue: 0, red: 0, neutral: 0, assassin: 0 };
  for (const a of assignment) {
    if (counts[a] === undefined) {
      console.error(`Puzzle ${idx}: bad role ${a}`);
      ok = false;
    } else counts[a]++;
  }
  if (counts.blue !== 9 || counts.red !== 8 || counts.neutral !== 7 || counts.assassin !== 1) {
    console.error(`Puzzle ${idx}: bad counts`, counts);
    ok = false;
  }
  const clue = String(firstClue.clue || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const num = parseInt(firstClue.number, 10);
  if (num < 2 || num > 4) {
    console.error(`Puzzle ${idx}: first clue number must be 2–4`);
    ok = false;
  }
  if (!clueValid(clue, words)) {
    console.error(`Puzzle ${idx}: clueValid failed for ${clue}`);
    ok = false;
  }
  if (!validateTargetIndices(assignment, {}, "blue", num, firstClue.targetIndices)) {
    console.error(`Puzzle ${idx}: bad targetIndices`);
    ok = false;
  }
});

if (!ok) process.exit(1);
console.log(`OK: ${puzzles.length} puzzles`);
