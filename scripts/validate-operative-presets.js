#!/usr/bin/env node
const path = require("path");
const { clueValid } = require("../lib/clueValidate");

const p = path.join(__dirname, "..", "data", "codenames-operative-puzzles.json");
const puzzles = require(p);

let err = 0;
for (let pi = 0; pi < puzzles.length; pi++) {
  const { blues, fillers, presetClues } = puzzles[pi];
  const all = [...blues, ...fillers];
  const bset = new Set(blues);
  if (new Set(all).size !== 25) {
    console.error(`Puzzle ${pi}: need 25 unique words`);
    err++;
  }
  for (const w of fillers) {
    if (bset.has(w)) {
      console.error(`Puzzle ${pi}: filler ${w} in blues`);
      err++;
    }
  }
  if (!Array.isArray(presetClues) || presetClues.length !== 5) {
    console.error(`Puzzle ${pi}: need 5 presetClues`);
    err++;
    continue;
  }
  for (let ci = 0; ci < presetClues.length; ci++) {
    const pc = presetClues[ci];
    const clue = String(pc.clue || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const n = parseInt(pc.number, 10);
    const targets = Array.isArray(pc.targets) ? pc.targets.map((t) => String(t).toUpperCase().replace(/[^A-Z]/g, "")) : [];
    if (n < 2 || n > 4 || targets.length !== n) {
      console.error(`Puzzle ${pi} clue ${ci}: bad n/targets`);
      err++;
      continue;
    }
    for (const t of targets) {
      if (!bset.has(t)) {
        console.error(`Puzzle ${pi} clue ${ci}: target ${t} not in blues`);
        err++;
      }
    }
    if (!clueValid(clue, all)) {
      console.error(`Puzzle ${pi} clue ${ci}: clueValid failed for "${clue}"`);
      err++;
    }
  }
}
if (err) process.exit(1);
console.log(`OK: ${puzzles.length} puzzles × 5 clues`);
