const { clueValid } = require("./clueValidate");

function teamWordsLeft(assignment, revealed, team) {
  let n = 0;
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (assignment[i] === team) n++;
  }
  return n;
}

function winnerFromState(assignment, revealed) {
  let blueLeft = 0;
  let redLeft = 0;
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (assignment[i] === "blue") blueLeft++;
    else if (assignment[i] === "red") redLeft++;
  }
  if (blueLeft === 0) return "blue";
  if (redLeft === 0) return "red";
  return null;
}

function simulateRedGuesses(assignment, revealed, guesses, clueNumber) {
  const maxSteps = clueNumber <= 0 ? 0 : clueNumber + 1;
  const steps = [];
  const next = { ...revealed };
  let assassinHit = false;

  for (const idx of guesses) {
    if (steps.length >= maxSteps) break;
    if (idx < 0 || idx > 24 || next[idx]) continue;
    const role = assignment[idx];
    if (role === "assassin") continue;
    next[idx] = role;
    steps.push({ index: idx, role, word: null });
    if (role === "assassin") {
      assassinHit = true;
      break;
    }
    if (role !== "red") break;
  }
  return { steps, revealed: next, assassinHit };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Synthetic clue: random letters until clueValid, so it never calls Gemini. */
function pickSyntheticClue(words) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 300; attempt++) {
    const len = 4 + Math.floor(Math.random() * 5);
    let s = "";
    for (let i = 0; i < len; i++) {
      s += alphabet[Math.floor(Math.random() * 26)];
    }
    if (/^[A-Z]{2,24}$/.test(s) && clueValid(s, words)) return s;
  }
  const fallbacks = [
    "QUARTZ",
    "ZEPHYR",
    "QUARK",
    "NYLON",
    "VEXIL",
    "FJORD",
    "GLYPH",
    "NYMPH",
  ];
  for (const f of fallbacks) {
    if (clueValid(f, words)) return f;
  }
  return "LINK";
}

function randomRedNumber(redLeft) {
  const cap = Math.min(9, redLeft);
  return 1 + Math.floor(Math.random() * cap);
}

function buildRedGuessOrder(revealed, assignment) {
  const unrevealed = [];
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (assignment[i] === "assassin") continue;
    unrevealed.push(i);
  }
  return shuffle(unrevealed);
}

/**
 * Full red team turn without LLM: synthetic clue + random guess order among unrevealed.
 * @param {string[]} words
 * @param {string[]} assignment
 * @param {Record<number,string>} revealed
 */
function runRedTurnLocal(words, assignment, revealed) {
  const redLeft = teamWordsLeft(assignment, revealed, "red");
  if (redLeft === 0) {
    return {
      clue: "PASS",
      number: 0,
      steps: [],
      revealed,
      gameOver: false,
      winner: null,
      redSimulated: true,
    };
  }

  const clue = pickSyntheticClue(words);
  const number = randomRedNumber(redLeft);
  const order = buildRedGuessOrder(revealed, assignment);
  const sim = simulateRedGuesses(assignment, revealed, order, number);
  const steps = sim.steps.map((s) => ({
    index: s.index,
    role: s.role,
    word: words[s.index],
  }));

  let gameOver = false;
  let winner = null;
  if (sim.assassinHit) {
    gameOver = true;
    winner = "blue";
  } else {
    const w = winnerFromState(assignment, sim.revealed);
    if (w) {
      gameOver = true;
      winner = w;
    }
  }

  return {
    clue,
    number,
    steps,
    revealed: sim.revealed,
    gameOver,
    winner,
    redSimulated: true,
  };
}

module.exports = {
  runRedTurnLocal,
  teamWordsLeft,
  winnerFromState,
  simulateRedGuesses,
};
