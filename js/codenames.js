(function () {
  const api = async (path, body) => {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || String(r.status));
    return j;
  };

  const els = {
    board: document.getElementById("cn-board"),
    status: document.getElementById("cn-status"),
    clueLine: document.getElementById("cn-clue"),
    btnNew: document.getElementById("cn-new"),
    btnClue: document.getElementById("cn-get-clue"),
    btnEnd: document.getElementById("cn-end-turn"),
    overlay: document.getElementById("cn-overlay"),
    overlayText: document.getElementById("cn-overlay-text"),
  };

  let token = null;
  let words = [];
  /** @type {Record<number,string>} */
  let revealed = {};
  let phase = "idle";
  let currentClue = null;
  let currentNumber = 0;
  let guessesLeft = 0;

  function setStatus(html) {
    els.status.innerHTML = html;
  }

  function setClue(text) {
    els.clueLine.textContent = text;
  }

  function showOverlay(text, dismissable) {
    els.overlayText.textContent = text;
    els.overlay.hidden = false;
    els.overlay.classList.toggle("cn-overlay--dismiss", !!dismissable);
  }

  function hideOverlay() {
    els.overlay.hidden = true;
  }

  function normalizeRevealed(raw) {
    const out = {};
    if (!raw) return out;
    for (const [k, v] of Object.entries(raw)) {
      const i = parseInt(k, 10);
      if (i >= 0 && i < 25) out[i] = v;
    }
    return out;
  }

  function renderBoard() {
    els.board.innerHTML = "";
    for (let i = 0; i < 25; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cn-cell";
      btn.dataset.index = String(i);
      const w = words[i] || "?";
      const r = revealed[i];
      if (r) {
        btn.classList.add("cn-cell--" + r);
        btn.textContent = w;
        btn.disabled = true;
      } else {
        btn.textContent = w;
        btn.disabled =
          phase !== "humanGuess" ||
          guessesLeft <= 0 ||
          phase === "aiTurn" ||
          phase === "idle";
      }
      els.board.appendChild(btn);
    }
  }

  function bindBoardClicks() {
    els.board.addEventListener("click", (e) => {
      const btn = e.target.closest(".cn-cell");
      if (!btn || btn.disabled) return;
      const idx = parseInt(btn.dataset.index, 10);
      if (phase === "humanGuess") onHumanPick(idx);
    });
  }

  async function onHumanPick(index) {
    if (phase !== "humanGuess" || guessesLeft <= 0) return;
    try {
      const res = await api("/api/codenames/reveal", {
        token,
        index,
        revealed,
        byTeam: "blue",
      });
      revealed = normalizeRevealed(res.revealed);
      guessesLeft -= 1;
      if (res.gameOver) {
        endGame(res.winner);
        return;
      }
      if (res.role !== "blue") {
        await finishHumanTurn();
        return;
      }
      if (guessesLeft <= 0) {
        await finishHumanTurn();
        return;
      }
      setStatus(
        `<strong>Your guess:</strong> ${res.word} was <span class="cn-tag cn-tag--blue">blue</span>. Guesses left this turn: ${guessesLeft}.`
      );
      renderBoard();
    } catch (err) {
      setStatus(`<span class="cn-err">${String(err.message)}</span>`);
    }
  }

  async function finishHumanTurn() {
    phase = "aiTurn";
    els.btnEnd.disabled = true;
    els.btnClue.disabled = true;
    setClue("—");
    setStatus("<strong>AI (red)</strong> is thinking…");
    renderBoard();
    try {
      const res = await api("/api/codenames/red-turn", { token, revealed });
      revealed = normalizeRevealed(res.revealed);
      let msg = res.clue === "PASS" ? "AI passes." : `AI clue: <strong>${res.clue} ${res.number}</strong>`;
      if (res.steps && res.steps.length) {
        msg += "<br/>Red guessed: ";
        msg += res.steps
          .map((s) => `${s.word} (${s.role})`)
          .join(" → ");
      }
      setStatus(msg);
      if (res.gameOver) {
        endGame(res.winner);
        return;
      }
      phase = "needClue";
      els.btnClue.disabled = false;
      setStatus(msg + "<br/><em>Get your next clue.</em>");
    } catch (err) {
      setStatus(`<span class="cn-err">${String(err.message)}</span>`);
      phase = "needClue";
      els.btnClue.disabled = false;
    }
    renderBoard();
  }

  function endGame(winner) {
    phase = "over";
    els.btnClue.disabled = true;
    els.btnEnd.disabled = true;
    els.btnNew.disabled = false;
    renderBoard();
    showOverlay(
      winner === "blue"
        ? "You win — all blue words found, or the AI hit the assassin."
        : winner === "red"
          ? "AI wins — all red words found, or you hit the assassin."
          : "Game over.",
      true
    );
    setStatus(
      winner === "blue"
        ? "<strong>You won.</strong> Start a new game anytime."
        : "<strong>AI won.</strong> New game?"
    );
  }

  async function newGame() {
    hideOverlay();
    els.btnNew.disabled = true;
    els.btnClue.disabled = true;
    els.btnEnd.disabled = true;
    phase = "loading";
    setClue("—");
    setStatus("Starting new game…");
    try {
      const res = await fetch("/api/codenames/new", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      token = j.token;
      words = j.words;
      revealed = {};
      phase = "needClue";
      setStatus(
        "You are <span class=\"cn-tag cn-tag--blue\">blue</span>. The AI is <span class=\"cn-tag cn-tag--red\">red</span>. Blue goes first. Get your clue from the AI spymaster."
      );
      els.btnClue.disabled = false;
      els.btnNew.disabled = false;
    } catch (e) {
      setStatus(
        `<span class="cn-err">${String(e.message)}</span><br/><small>If you opened this file locally, run <code>vercel dev</code> or deploy to Vercel — the API runs on the server.</small>`
      );
      phase = "idle";
      els.btnNew.disabled = false;
    }
    renderBoard();
  }

  async function getBlueClue() {
    if (!token || phase !== "needClue") return;
    els.btnClue.disabled = true;
    setStatus("Asking Gemini for a blue clue…");
    try {
      const res = await api("/api/codenames/clue", {
        token,
        team: "blue",
        revealed,
      });
      if (res.clue === "PASS" || res.number === 0) {
        setClue("PASS");
        setStatus("No blue words left — ending your turn.");
        await finishHumanTurn();
        return;
      }
      currentClue = res.clue;
      currentNumber = res.number;
      guessesLeft = res.number + 1;
      setClue(`${res.clue} · ${res.number}`);
      setStatus(
        `Your clue: <strong>${res.clue} ${res.number}</strong>. You may make up to <strong>${guessesLeft}</strong> guesses. Tap words. Wrong color ends your turn.`
      );
      phase = "humanGuess";
      els.btnEnd.disabled = false;
    } catch (e) {
      setStatus(`<span class="cn-err">${String(e.message)}</span>`);
      els.btnClue.disabled = false;
    }
    renderBoard();
  }

  async function endTurnEarly() {
    if (phase !== "humanGuess") return;
    guessesLeft = 0;
    await finishHumanTurn();
  }

  function init() {
    if (!els.board) return;
    bindBoardClicks();
    els.btnNew.addEventListener("click", newGame);
    els.btnClue.addEventListener("click", getBlueClue);
    els.btnEnd.addEventListener("click", () => endTurnEarly());
    els.overlay.addEventListener("click", () => {
      if (els.overlay.classList.contains("cn-overlay--dismiss")) hideOverlay();
    });
    renderBoard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
