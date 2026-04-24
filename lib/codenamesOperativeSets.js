/**
 * Human operative boards: paired blues + fillers + preset clue ladder (see data file).
 */
const path = require("path");
const { normCodeWord } = require("./codenamesWordNorm");

const PUZZLES = require(path.join(__dirname, "..", "data", "codenames-operative-puzzles.json"));

function assertOperativeData() {
  if (!Array.isArray(PUZZLES) || PUZZLES.length === 0) {
    throw new Error("operative: codenames-operative-puzzles.json missing or empty");
  }
  for (let i = 0; i < PUZZLES.length; i++) {
    const p = PUZZLES[i];
    if (!p.blues || p.blues.length !== 9 || !p.fillers || p.fillers.length !== 16) {
      throw new Error(`operative: puzzle ${i} bad blues/fillers length`);
    }
    const u = new Set([...p.blues, ...p.fillers].map((w) => normCodeWord(w)));
    if (u.size !== 25) throw new Error(`operative: puzzle ${i} must have 25 unique words`);
    const b = new Set(p.blues.map((w) => normCodeWord(w)));
    for (const f of p.fillers) {
      const F = normCodeWord(f);
      if (b.has(F)) throw new Error(`operative: puzzle ${i} filler ${F} in blues`);
    }
    if (!Array.isArray(p.presetClues) || p.presetClues.length !== 5) {
      throw new Error(`operative: puzzle ${i} needs 5 presetClues`);
    }
  }
}

assertOperativeData();

module.exports = {
  OPERATIVE_PUZZLES: PUZZLES,
  assertOperativeData,
};
