#!/usr/bin/env node
/**
 * Validates lib/codenamesOperativeSets.js (loads module — runs assertOperativeData).
 */
require("../lib/codenamesOperativeSets");
const { buildOperativeHumanBoard } = require("../lib/state");

for (let i = 0; i < 200; i++) {
  const { words, assignment, presetClues } = buildOperativeHumanBoard();
  if (words.length !== 25 || assignment.length !== 25) process.exit(1);
  if (!Array.isArray(presetClues) || presetClues.length !== 5) {
    console.error("presetClues must have 5 entries");
    process.exit(1);
  }
  const counts = { blue: 0, red: 0, neutral: 0, assassin: 0 };
  const wset = new Set();
  for (let j = 0; j < 25; j++) {
    counts[assignment[j]]++;
    wset.add(words[j]);
  }
  if (wset.size !== 25) {
    console.error("duplicate word on board");
    process.exit(1);
  }
  if (counts.blue !== 9 || counts.red !== 8 || counts.neutral !== 7 || counts.assassin !== 1) {
    console.error("bad assignment counts", counts);
    process.exit(1);
  }
}
console.log("operative sets + 200 random boards OK");
