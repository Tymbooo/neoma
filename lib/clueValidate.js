const { normCodeWord } = require("./codenamesWordNorm");

function clueValid(clue, words) {
  const c = normCodeWord(clue);
  if (c === "PASS") return true;
  if (!c || c.length < 2) return false;
  for (const w of words) {
    const W = normCodeWord(w);
    if (!W) continue;
    if (W === c) return false;
    if (W.includes(c) || c.includes(W)) return false;
  }
  return true;
}

module.exports = { clueValid };
