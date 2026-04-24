import {
  buildAnimals,
  BASE_TRAIT_QUESTIONS,
  EXTENDED_TRAIT_QUESTIONS,
  SOFT_TRAIT_QUESTIONS,
} from "./animal-farm-data.js";

const MAX_ROUNDS = 10;
const QUESTIONS_PER_ROUND = 8;
const SOFT_IG_CAP = 28;

const ANIMALS = buildAnimals();

const TRAIT_QUESTIONS = {
  ...BASE_TRAIT_QUESTIONS,
  ...EXTENDED_TRAIT_QUESTIONS,
  ...SOFT_TRAIT_QUESTIONS,
};
for (const a of ANIMALS) {
  TRAIT_QUESTIONS[`sp_${a.id}`] = `Is it specifically **${a.name}** (this list)?`;
}

const TRAIT_KEYS = Object.keys(TRAIT_QUESTIONS);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function entropyBinary(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function splitScore(pool, key) {
  let yes = 0;
  for (const a of pool) {
    if (a[key]) yes++;
  }
  const no = pool.length - yes;
  if (yes === 0 || no === 0) return null;
  const p = yes / pool.length;
  const H = entropyBinary(p);
  const balance = -Math.abs(yes - no);
  return { key, H, balance };
}

function rankSplittable(pool, asked) {
  const ranked = [];
  for (const key of TRAIT_KEYS) {
    if (asked.has(key)) continue;
    const sc = splitScore(pool, key);
    if (sc) ranked.push(sc);
  }
  ranked.sort((a, b) => b.H - a.H || b.balance - a.balance);
  return ranked;
}

/**
 * Species pins ∪ top SOFT_IG_CAP by information gain, shuffled, then up to 8.
 * Fills from full ranked list if merged pool is thin.
 */
function pickRoundTraits(pool, asked) {
  const ranked = rankSplittable(pool, asked);
  const pins = pool.map((a) => `sp_${a.id}`).filter((k) => !asked.has(k));
  const topSlice = ranked.slice(0, SOFT_IG_CAP).map((r) => r.key);
  const merged = [...new Set([...pins, ...topSlice])];
  shuffle(merged);
  let picked = merged.slice(0, Math.min(QUESTIONS_PER_ROUND, merged.length));
  if (picked.length < QUESTIONS_PER_ROUND) {
    for (const r of ranked) {
      if (picked.length >= QUESTIONS_PER_ROUND) break;
      if (!picked.includes(r.key)) picked.push(r.key);
    }
  }
  return picked.slice(0, QUESTIONS_PER_ROUND);
}

function main() {
  const pickPhase = document.getElementById("af-pick-phase");
  const answerPhase = document.getElementById("af-answer-phase");
  const finalPhase = document.getElementById("af-final-phase");
  const gridEl = document.getElementById("af-question-grid");
  const chosenEl = document.getElementById("af-chosen-text");
  const revealEl = document.getElementById("af-reveal");
  const roundEl = document.getElementById("af-round");
  const poolEl = document.getElementById("af-pool-size");
  const btnNext = document.getElementById("af-next-round");
  const btnBack = document.getElementById("af-back-to-pick");
  const btnStart = document.getElementById("af-start");
  const btnReset = document.getElementById("af-reset");
  const guessInput = document.getElementById("af-guess");
  const btnGuess = document.getElementById("af-submit-guess");
  const finalMsg = document.getElementById("af-final-msg");
  const logEl = document.getElementById("af-answered-log");
  const datalist = document.getElementById("af-animals");

  if (datalist) {
    datalist.innerHTML = "";
    for (const a of ANIMALS) {
      const o = document.createElement("option");
      o.value = a.name;
      datalist.appendChild(o);
    }
  }

  let secret = null;
  /** @type {typeof ANIMALS} */
  let pool = [];
  const asked = new Set();
  /** @type { { q: string, a: string }[] } */
  let answeredLog = [];
  let roundNum = 1;
  /** @type {string | null} */
  let pendingKey = null;
  /** @type {string[]} */
  let currentRoundKeys = [];

  function show(el, on) {
    el.hidden = !on;
  }

  function renderLog() {
    if (!logEl) return;
    if (!answeredLog.length) {
      logEl.innerHTML = "";
      return;
    }
    logEl.innerHTML =
      "<strong>Answers so far</strong><br/>" +
      answeredLog
        .map(
          (e) =>
            `<span class="${e.a === "Yes" ? "af-log-yes" : "af-log-no"}">${e.a}</span> — ${e.q.replace(/\*\*/g, "")}`
        )
        .join("<br/>");
  }

  function enterFinal() {
    pendingKey = null;
    show(pickPhase, false);
    show(answerPhase, false);
    show(finalPhase, true);
    finalMsg.textContent = "";
    guessInput.value = "";
    renderLog();
  }

  function beginRound() {
    if (pool.length <= 1 || roundNum > MAX_ROUNDS) {
      enterFinal();
      return;
    }
    let roundKeys = pickRoundTraits(pool, asked);
    if (roundKeys.length === 0 && pool.length > 1) {
      const ranked = rankSplittable(pool, asked);
      roundKeys = ranked.slice(0, QUESTIONS_PER_ROUND).map((r) => r.key);
    }
    if (roundKeys.length === 0) {
      enterFinal();
      return;
    }
    currentRoundKeys = roundKeys;
    roundEl.textContent = String(roundNum);
    poolEl.textContent = String(pool.length);
    gridEl.innerHTML = "";
    for (const key of currentRoundKeys) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "af-qbtn";
      btn.textContent = TRAIT_QUESTIONS[key].replace(/\*\*/g, "");
      btn.addEventListener("click", () => onChooseQuestion(key));
      gridEl.appendChild(btn);
    }
    show(pickPhase, true);
    show(answerPhase, false);
  }

  function onChooseQuestion(key) {
    pendingKey = key;
    const truth = !!secret[key];
    chosenEl.textContent = TRAIT_QUESTIONS[key].replace(/\*\*/g, "");
    revealEl.textContent = `The game answers: ${truth ? "Yes" : "No"}.`;
    revealEl.style.color = truth ? "#86efac" : "#93c5fd";
    poolEl.textContent = String(pool.length);
    show(pickPhase, false);
    show(answerPhase, true);
    const willEnd =
      roundNum >= MAX_ROUNDS ||
      pool.filter((a) => a[key] === truth).length <= 1;
    btnNext.textContent = willEnd ? "Continue to final guess" : "Next round";
  }

  function backToPick() {
    pendingKey = null;
    revealEl.textContent = "";
    show(answerPhase, false);
    show(pickPhase, true);
  }

  btnBack?.addEventListener("click", backToPick);

  btnNext.addEventListener("click", () => {
    if (!pendingKey) return;
    const key = pendingKey;
    const truth = !!secret[key];
    pendingKey = null;
    asked.add(key);
    answeredLog.push({ q: TRAIT_QUESTIONS[key], a: truth ? "Yes" : "No" });
    pool = pool.filter((a) => a[key] === truth);
    poolEl.textContent = String(pool.length);
    revealEl.textContent = "";

    roundNum++;
    if (pool.length <= 1 || roundNum > MAX_ROUNDS) {
      enterFinal();
      return;
    }
    beginRound();
  });

  function startGame() {
    secret = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    pool = [...ANIMALS];
    asked.clear();
    answeredLog = [];
    roundNum = 1;
    pendingKey = null;
    currentRoundKeys = [];
    show(finalPhase, false);
    show(answerPhase, false);
    beginRound();
  }

  btnStart.addEventListener("click", startGame);
  btnReset.addEventListener("click", startGame);

  btnGuess.addEventListener("click", () => {
    const raw = guessInput.value.trim().toLowerCase();
    const match = ANIMALS.find((a) => a.name.toLowerCase() === raw);
    if (!match) {
      finalMsg.textContent = "Type an animal name from the list (exact spelling).";
      finalMsg.style.color = "#fca5a5";
      return;
    }
    if (match.id === secret.id) {
      finalMsg.textContent = "You got it — well played!";
      finalMsg.style.color = "#4ade80";
    } else {
      finalMsg.textContent = `Nice try — the mystery animal was ${secret.name}.`;
      finalMsg.style.color = "#fca5a5";
    }
    console.log("[Animal Farm] Secret:", secret.name, answeredLog);
  });

  show(pickPhase, false);
  show(answerPhase, false);
  show(finalPhase, false);
}

main();
