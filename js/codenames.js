(function () {
  const api = async (path, body) => {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = [j.error, j.hint].filter(Boolean).join(" — ");
      throw new Error(msg || r.statusText || String(r.status));
    }
    return j;
  };

  const els = {
    board: document.getElementById("cn-board"),
    status: document.getElementById("cn-status"),
    clueLine: document.getElementById("cn-clue"),
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
  /** Successful blue reveals this operative turn (matches spymaster count N) */
  let bluesThisTurn = 0;

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

  /** Fetch blue clue when phase is needClue (after new game or after AI turn). */
  function scheduleAutoClue() {
    queueMicrotask(() => {
      if (phase === "needClue" && token) getBlueClue();
    });
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
      bluesThisTurn += 1;
      if (bluesThisTurn >= currentNumber) {
        setStatus(
          `<strong>Your guess:</strong> ${res.word} was <span class="cn-tag cn-tag--blue">blue</span> — that’s <strong>${currentNumber}</strong> for this clue. Ending your turn.`
        );
        renderBoard();
        await finishHumanTurn();
        return;
      }
      if (guessesLeft <= 0) {
        await finishHumanTurn();
        return;
      }
      setStatus(
        `<strong>Your guess:</strong> ${res.word} was <span class="cn-tag cn-tag--blue">blue</span>. Blues for this clue: <strong>${bluesThisTurn}/${currentNumber}</strong>. Guesses left: ${guessesLeft}.`
      );
      renderBoard();
    } catch (err) {
      setStatus(`<span class="cn-err">${String(err.message)}</span>`);
    }
  }

  async function finishHumanTurn() {
    phase = "aiTurn";
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
      setStatus(msg + "<br/><em>Fetching your clue…</em>");
      renderBoard();
      scheduleAutoClue();
    } catch (err) {
      setStatus(
        `<span class="cn-err">${String(err.message)}</span><br/><small>Go back to <strong>All games</strong> and open Codenames again to retry.</small>`
      );
      phase = "needClue";
      renderBoard();
    }
  }

  function endGame(winner) {
    phase = "over";
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
        ? "<strong>You won.</strong> Use <strong>← All games</strong> and open Codenames again for a new board."
        : "<strong>AI won.</strong> Use <strong>← All games</strong> and open Codenames again for a new board."
    );
  }

  async function startSession() {
    hideOverlay();
    phase = "loading";
    setClue("—");
    setStatus("Starting game…");
    renderBoard();
    try {
      const res = await fetch("/api/codenames/new", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      token = j.token;
      words = j.words;
      revealed = {};
      bluesThisTurn = 0;
      phase = "needClue";
      setStatus(
        "You are <span class=\"cn-tag cn-tag--blue\">blue</span>; AI is <span class=\"cn-tag cn-tag--red\">red</span>. <em>Fetching your first clue…</em>"
      );
      renderBoard();
      scheduleAutoClue();
    } catch (e) {
      setStatus(
        `<span class="cn-err">${String(e.message)}</span><br/><small>If you opened this file locally, run <code>vercel dev</code> or deploy to Vercel — the API runs on the server. Then use <strong>← All games</strong> and return here to retry.</small>`
      );
      phase = "idle";
    }
    renderBoard();
  }

  async function getBlueClue() {
    if (!token || phase !== "needClue") return;
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
        bluesThisTurn = 0;
        await finishHumanTurn();
        return;
      }
      currentClue = res.clue;
      currentNumber = res.number;
      bluesThisTurn = 0;
      guessesLeft = res.number + 1;
      setClue(`${res.clue} · ${res.number}`);
      setStatus(
        `Your clue: <strong>${res.clue} ${res.number}</strong>. Reveal up to <strong>${currentNumber}</strong> blue words for this clue (turn ends then), or use at most <strong>${guessesLeft}</strong> guesses total. Wrong color ends the turn.`
      );
      phase = "humanGuess";
    } catch (e) {
      setStatus(
        `<span class="cn-err">${String(e.message)}</span><br/><small>Go back to <strong>All games</strong> and open Codenames again to retry.</small>`
      );
    }
    renderBoard();
  }

  function init() {
    if (!els.board) return;
    bindBoardClicks();
    els.overlay.addEventListener("click", () => {
      if (els.overlay.classList.contains("cn-overlay--dismiss")) hideOverlay();
    });
    renderBoard();
    startSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
