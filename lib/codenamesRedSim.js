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

/** Chance each guess targets a random red word vs a random wrong (neutral/blue) tile. */
const RED_TRY_RED_PROB = 0.75;

/**
 * With P(single flip is red) ≈ 0.75: E[flips | cap 2] = 1.75, E[flips | cap 3] = 1 + p + p² = 2.3125.
 * Weight 5/9 on 2 and 4/9 on 3 gives E[flips] = 2 before endgame (only one red left uses cap 1).
 */
function pickRedMaxAttempts() {
  return Math.random() < 5 / 9 ? 2 : 3;
}

/**
 * No LLM: up to `maxAttempts` guesses (2 or 3, weighted for ~2 flips/turn at p=0.75). Each step rolls "try red" vs "mistake";
 * never picks assassin. Stops after a non-red reveal (normal Codenames).
 * @param {string[]} assignment
 * @param {Record<number,string>} revealed
 * @param {number} maxAttempts
 * @param {number} pTryRed
 */
function simulateAverageRedTurn(assignment, revealed, maxAttempts, pTryRed) {
  const steps = [];
  const next = { ...revealed };
  let assassinHit = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reds = [];
    const wrongs = [];
    for (let i = 0; i < 25; i++) {
      if (next[i]) continue;
      const role = assignment[i];
      if (role === "assassin") continue;
      if (role === "red") reds.push(i);
      else wrongs.push(i);
    }

    if (reds.length === 0 && wrongs.length === 0) break;

    const tryRed = Math.random() < pTryRed;
    let idx = null;
    if (tryRed && reds.length > 0) {
      idx = reds[Math.floor(Math.random() * reds.length)];
    } else if (!tryRed && wrongs.length > 0) {
      idx = wrongs[Math.floor(Math.random() * wrongs.length)];
    } else if (reds.length > 0) {
      idx = reds[Math.floor(Math.random() * reds.length)];
    } else if (wrongs.length > 0) {
      idx = wrongs[Math.floor(Math.random() * wrongs.length)];
    } else {
      break;
    }

    const role = assignment[idx];
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

/**
 * Full red team turn without LLM: synthetic clue + random play (~2 cards/turn in expectation, 75% “aim for red”).
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
  const maxAttempts = redLeft === 1 ? 1 : pickRedMaxAttempts();
  const number = maxAttempts;
  const sim = simulateAverageRedTurn(assignment, revealed, maxAttempts, RED_TRY_RED_PROB);
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
