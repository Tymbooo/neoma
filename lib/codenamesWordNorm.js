/**
 * Normalize Codenames clue/board tokens: strip accents, uppercase, ASCII letters only.
 * Keeps Ñ as N so clues stay single-token ASCII (matches grid display rules).
 */
function normCodeWord(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/Ñ/g, "N")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

module.exports = { normCodeWord };
