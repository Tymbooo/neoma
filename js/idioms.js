const NEED = 3;
const PASS = 3;

/** @type {{ id: string, text: string, correct: string, wrong: string[] }[] | null} */
let BANK = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {string} correct
 * @param {string[]} allCorrect
 * @param {number} selfIndex
 */
function pickThreeWrong(correct, allCorrect, selfIndex) {
  const idxs = allCorrect.map((_, i) => i).filter((i) => i !== selfIndex);
  shuffle(idxs);
  const out = [];
  for (const i of idxs) {
    if (out.length >= 3) break;
    const t = allCorrect[i];
    if (t === correct) continue;
    if (!out.includes(t)) out.push(t);
  }
  const fillers = [
    "It refers only to literal animals or objects, not people.",
    "It is slang for refusing to speak Spanish.",
    "It means the speaker is changing jobs tomorrow.",
  ];
  let f = 0;
  while (out.length < 3) {
    out.push(fillers[f % fillers.length]);
    f++;
  }
  return out.slice(0, 3);
}

/**
 * @param {{ text: string, correct: string }[]} core
 */
function enrichBank(core) {
  const allCorrect = core.map((c) => c.correct);
  return core.map((c, selfIndex) => ({
    id: String(selfIndex + 1),
    text: c.text,
    correct: c.correct,
    wrong: pickThreeWrong(c.correct, allCorrect, selfIndex),
  }));
}

async function ensureBank() {
  if (BANK) return;
  const url = new URL("../data/idioms-spanish.json", import.meta.url);
  const r = await fetch(url);
  if (!r.ok) throw new Error("Could not load idiom list.");
  const core = await r.json();
  if (!Array.isArray(core) || core.length < NEED) {
    throw new Error("Idiom list is too short.");
  }
  BANK = enrichBank(core);
}

function main() {
  const intro = document.getElementById("idioms-intro");
  const play = document.getElementById("idioms-play");
  const quoteEl = document.getElementById("idioms-quote");
  const choicesEl = document.getElementById("idioms-choices");
  const progressEl = document.getElementById("idioms-progress");
  const beginBtn = document.getElementById("idioms-begin");
  const resultEl = document.getElementById("idioms-result");

  let deck = [];
  let idx = 0;
  let score = 0;
  let locked = false;

  function renderRound() {
    locked = false;
    resultEl.textContent = "";
    resultEl.hidden = true;
    const card = deck[idx];
    quoteEl.textContent = `“${card.text}”`;
    const opts = shuffle([
      { text: card.correct, ok: true },
      ...card.wrong.map((t) => ({ text: t, ok: false })),
    ]);
    choicesEl.innerHTML = "";
    for (const o of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "idioms-choice";
      b.textContent = o.text;
      b.addEventListener("click", () => {
        if (locked) return;
        locked = true;
        if (o.ok) {
          score++;
          b.classList.add("idioms-choice--correct");
        } else {
          b.classList.add("idioms-choice--wrong");
          const right = opts.find((x) => x.ok);
          for (const c of choicesEl.children) {
            if (c.textContent === right.text) c.classList.add("idioms-choice--correct");
          }
        }
        progressEl.textContent = `Question ${idx + 1} of ${NEED} — ${score} correct so far`;
        const next = document.createElement("button");
        next.type = "button";
        next.className = "af-btn af-btn--primary";
        next.style.marginTop = "0.75rem";
        next.textContent = idx + 1 < NEED ? "Next idiom" : "See result";
        next.addEventListener("click", () => {
          next.remove();
          if (idx + 1 < NEED) {
            idx++;
            renderRound();
          } else {
            finish();
          }
        });
        choicesEl.appendChild(next);
      });
      choicesEl.appendChild(b);
    }
    progressEl.textContent = `Question ${idx + 1} of ${NEED} — ${score} correct so far`;
  }

  function finish() {
    quoteEl.textContent = "";
    choicesEl.innerHTML = "";
    progressEl.textContent = "";
    resultEl.hidden = false;
    const won = score >= PASS;
    if (won) {
      resultEl.textContent = `You won — ${score} / ${NEED} correct.`;
      resultEl.style.color = "#4ade80";
    } else {
      resultEl.textContent = `You scored ${score} / ${NEED}. Get all ${NEED} right to win.`;
      resultEl.style.color = "#fca5a5";
    }
    void globalThis.GameResult?.show?.({
      won,
      detail: won ? `${score} / ${NEED} correct.` : `Scored ${score} / ${NEED}; need ${NEED} / ${NEED} to win.`,
    });
    const again = document.createElement("button");
    again.type = "button";
    again.className = "af-btn af-btn--primary";
    again.textContent = "Begin round";
    again.addEventListener("click", () => {
      again.remove();
      start();
    });
    choicesEl.appendChild(again);
  }

  async function start() {
    try {
      await ensureBank();
    } catch (e) {
      setStatusError(String(e.message || e));
      return;
    }
    intro.hidden = true;
    play.hidden = false;
    deck = shuffle(BANK).slice(0, NEED);
    idx = 0;
    score = 0;
    renderRound();
  }

  function setStatusError(msg) {
    const p = intro.querySelector(".idioms-load-err") || document.createElement("p");
    p.className = "af-copy idioms-load-err";
    p.style.color = "#fca5a5";
    p.textContent = msg;
    if (!p.parentNode) intro.appendChild(p);
  }

  beginBtn.addEventListener("click", start);
}

main();
