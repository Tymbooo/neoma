(function () {
  /** @type {"operative" | "spymaster" | null} */
  let humanRole = null;

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
    rolePicker: document.getElementById("cn-role-picker"),
    gameMain: document.getElementById("cn-game-main"),
    intro: document.getElementById("cn-intro"),
    board: document.getElementById("cn-board"),
    status: document.getElementById("cn-status"),
    clueLine: document.getElementById("cn-clue"),
    overlay: document.getElementById("cn-overlay"),
    overlayText: document.getElementById("cn-overlay-text"),
    humanCluePanel: document.getElementById("cn-human-clue-panel"),
    humanClue: document.getElementById("cn-human-clue"),
    humanNumber: document.getElementById("cn-human-number"),
    btnHumanClue: document.getElementById("cn-btn-human-clue"),
  };

  let token = null;
  let words = [];
  /** @type {Record<number,string>} */
  let revealed = {};
  let phase = "idle";
  let currentClue = null;
  let currentNumber = 0;
  let guessesLeft = 0;
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

  function showHumanCluePanel() {
    if (els.humanCluePanel) els.humanCluePanel.hidden = false;
  }

  function hideHumanCluePanel() {
    if (els.humanCluePanel) els.humanCluePanel.hidden = true;
  }

  function scheduleAutoClue() {
    queueMicrotask(() => {
      if (humanRole === "operative" && phase === "needClue" && token) getBlueClue();
    });
  }

  function boardPickDisabled() {
    return (
      phase !== "humanGuess" ||
      guessesLeft <= 0 ||
      phase === "aiTurn" ||
      phase === "idle" ||
      phase === "loading" ||
      phase === "needHumanClue" ||
      phase === "aiBlueGuess" ||
      phase === "over"
    );
  }

  function renderBoard() {
    if (!els.board) return;
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
        btn.disabled = boardPickDisabled();
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
        await runRedTurnAfterBlue("");
        return;
      }
      bluesThisTurn += 1;
      if (bluesThisTurn >= currentNumber) {
        setStatus(
          `<strong>Your guess:</strong> ${res.word} was <span class="cn-tag cn-tag--blue">blue</span> — that’s <strong>${currentNumber}</strong> for this clue. Ending your turn.`
        );
        renderBoard();
        await runRedTurnAfterBlue("");
        return;
      }
      if (guessesLeft <= 0) {
        await runRedTurnAfterBlue("");
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

  /**
   * @param {string} prefixHtml optional HTML shown before red phase (e.g. blue AI recap)
   */
  async function runRedTurnAfterBlue(prefixHtml) {
    phase = "aiTurn";
    setClue("—");
    hideHumanCluePanel();
    const pre = prefixHtml ? `${prefixHtml}<br/>` : "";
    setStatus(`${pre}<strong>AI (red)</strong> is playing…`);
    renderBoard();
    try {
      const res = await api("/api/codenames/red-turn", { token, revealed });
      revealed = normalizeRevealed(res.revealed);
      let msg = pre;
      msg += res.clue === "PASS" ? "Red passes." : `Red clue: <strong>${res.clue} ${res.number}</strong>`;
      if (res.steps && res.steps.length) {
        msg += "<br/>Red guessed: ";
        msg += res.steps.map((s) => `${s.word} (${s.role})`).join(" → ");
      }
      setStatus(msg);
      if (res.gameOver) {
        endGame(res.winner);
        return;
      }
      if (humanRole === "operative") {
        phase = "needClue";
        setStatus(msg + "<br/><em>Fetching your clue…</em>");
        renderBoard();
        scheduleAutoClue();
      } else {
        phase = "needHumanClue";
        setStatus(msg + "<br/><strong>Your turn:</strong> give the blue team a clue.");
        showHumanCluePanel();
        if (els.humanClue) els.humanClue.value = "";
        if (els.humanNumber) els.humanNumber.value = "1";
        renderBoard();
      }
    } catch (err) {
      setStatus(
        `<span class="cn-err">${String(err.message)}</span><br/><small>Go back to <strong>All games</strong> and open Codenames again to retry.</small>`
      );
      phase = humanRole === "operative" ? "needClue" : "needHumanClue";
      if (humanRole === "spymaster") showHumanCluePanel();
      renderBoard();
    }
  }

  function endGame(winner) {
    phase = "over";
    hideHumanCluePanel();
    renderBoard();
    showOverlay(
      winner === "blue"
        ? "Blue wins — all blue words found, or red hit the assassin."
        : winner === "red"
          ? "Red wins — all red words found, or blue hit the assassin."
          : "Game over.",
      true
    );
    setStatus(
      winner === "blue"
        ? "<strong>Blue won.</strong> Use <strong>← All games</strong> and open Codenames again for a new board."
        : "<strong>Red won.</strong> Use <strong>← All games</strong> and open Codenames again for a new board."
    );
  }

  async function startSession() {
    hideOverlay();
    phase = "loading";
    setClue("—");
    hideHumanCluePanel();
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

      if (humanRole === "operative") {
        phase = "needClue";
        setStatus(
          "Blue operative — <span class=\"cn-tag cn-tag--blue\">Gemini</span> will clue you. Red uses a fast local sim (no extra API)."
        );
        renderBoard();
        scheduleAutoClue();
      } else {
        phase = "needHumanClue";
        setStatus(
          "Blue spymaster — enter your clue and number. <span class=\"cn-tag cn-tag--blue\">Gemini</span> plays operative. Red uses a fast local sim."
        );
        showHumanCluePanel();
        if (els.humanClue) els.humanClue.value = "";
        if (els.humanNumber) els.humanNumber.value = "1";
        renderBoard();
      }
    } catch (e) {
      setStatus(
        `<span class="cn-err">${String(e.message)}</span><br/><small>If you opened this file locally, run <code>vercel dev</code> or deploy to Vercel — the API runs on the server.</small>`
      );
      phase = "idle";
    }
    renderBoard();
  }

  async function getBlueClue() {
    if (!token || phase !== "needClue" || humanRole !== "operative") return;
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
        await runRedTurnAfterBlue("");
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

  async function submitHumanClue() {
    if (!token || phase !== "needHumanClue" || humanRole !== "spymaster") return;

    const rawClue = String(els.humanClue?.value || "").trim();
    const clue = rawClue.toUpperCase().replace(/[^A-Z]/g, "");
    const num = parseInt(String(els.humanNumber?.value ?? "1"), 10);

    if (clue === "PASS" && num === 0) {
      /* ok */
    } else if (clue.length >= 2 && num >= 1 && num <= 9) {
      /* ok */
    } else {
      setStatus(
        "Enter one clue word (letters, 2+ chars) and a number 1–9, or word <strong>PASS</strong> with number <strong>0</strong>."
      );
      return;
    }

    phase = "aiBlueGuess";
    hideHumanCluePanel();
    setStatus("Blue operative (Gemini) is guessing…");
    els.btnHumanClue.disabled = true;
    renderBoard();

    try {
      const res = await api("/api/codenames/blue-operate", {
        token,
        revealed,
        clue: clue === "PASS" ? "PASS" : clue,
        number: num,
      });
      revealed = normalizeRevealed(res.revealed);

      let prefix = "";
      if (res.clue === "PASS" || res.number === 0) {
        setClue("PASS");
        prefix = "<strong>You passed.</strong> No guesses.";
      } else {
        setClue(`${res.clue} · ${res.number}`);
        prefix = `Your clue: <strong>${res.clue} ${res.number}</strong>.`;
        if (res.steps && res.steps.length) {
          prefix += " Blue guessed: ";
          prefix += res.steps.map((s) => `${s.word} (${s.role})`).join(" → ");
        } else {
          prefix += " (no valid guesses.)";
        }
      }

      if (res.gameOver) {
        setStatus(prefix);
        endGame(res.winner);
        return;
      }

      await runRedTurnAfterBlue(prefix);
    } catch (e) {
      setStatus(`<span class="cn-err">${String(e.message)}</span>`);
      phase = "needHumanClue";
      showHumanCluePanel();
    } finally {
      els.btnHumanClue.disabled = false;
    }
    renderBoard();
  }

  function setIntroForRole() {
    if (!els.intro) return;
    if (humanRole === "operative") {
      els.intro.innerHTML =
        "You are the <strong>blue operative</strong>. After a clue <strong>N</strong>, tap words: your turn ends when you’ve revealed <strong>N</strong> blue words, run out of guesses (<strong>N+1</strong> max), or pick a non-blue. <strong>Red</strong> is simulated on the server (random clue + random guess order) — no Gemini calls for red.";
    } else {
      els.intro.innerHTML =
        "You are the <strong>blue spymaster</strong>. Submit a legal one-word clue and a number (or <strong>PASS</strong> + <strong>0</strong>). <strong>Gemini</strong> plays the blue operative. <strong>Red</strong> is simulated locally (no API). For a new board, use <strong>← All games</strong> and re-enter.";
    }
  }

  function chooseRole(role) {
    humanRole = role;
    if (els.rolePicker) els.rolePicker.hidden = true;
    if (els.gameMain) els.gameMain.hidden = false;
    setIntroForRole();
    startSession();
  }

  function init() {
    if (!els.board) return;
    bindBoardClicks();
    els.overlay.addEventListener("click", () => {
      if (els.overlay.classList.contains("cn-overlay--dismiss")) hideOverlay();
    });

    document.getElementById("cn-role-operative")?.addEventListener("click", () => {
      chooseRole("operative");
    });
    document.getElementById("cn-role-spymaster")?.addEventListener("click", () => {
      chooseRole("spymaster");
    });

    els.btnHumanClue?.addEventListener("click", submitHumanClue);
    els.humanClue?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitHumanClue();
      }
    });

    renderBoard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
