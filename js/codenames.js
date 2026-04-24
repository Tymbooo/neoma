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
    spoilerPanel: document.getElementById("cn-spoiler"),
    spoilerWords: document.getElementById("cn-spoiler-words"),
    spoilerLabel: document.getElementById("cn-spoiler-label"),
    cheatToggle: document.getElementById("cn-cheat-toggle"),
    log: document.getElementById("cn-log"),
  };

  let token = null;
  let words = [];
  /** Spymaster-only: server sends team per cell (operative never receives this). */
  /** @type {string[] | null} */
  let keyAssignment = null;
  /** @type {Record<number,string>} */
  let revealed = {};
  /** Which side flipped the tile (client-only; for borders). */
  /** @type {Record<number, "blue" | "red">} */
  let revealedBy = {};
  /** Spymaster: clue-fit scores (0–100) from last Gemini blue turn, keyed by cell index. */
  /** @type {Record<number, number>} */
  let spymasterClueFitByIndex = {};
  let phase = "idle";
  let currentClue = null;
  let currentNumber = 0;
  let guessesLeft = 0;
  let bluesThisTurn = 0;
  /** @type {{ word: string, role: string }[]} */
  let currentHumanTurnPicks = [];

  function clearGameLog() {
    if (!els.log) return;
    els.log.innerHTML = "";
    els.log.hidden = true;
  }

  function appendGameLog(html) {
    if (!els.log) return;
    els.log.hidden = false;
    const p = document.createElement("p");
    p.className = "cn-log__entry";
    p.innerHTML = html;
    els.log.appendChild(p);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function logHumanBlueTurnEnd(reason) {
    if (!currentClue && currentNumber === 0 && !currentHumanTurnPicks.length) return;
    const allowance = currentNumber;
    const seq =
      currentHumanTurnPicks.length === 0
        ? "—"
        : currentHumanTurnPicks.map((p) => `${p.word} (${p.role})`).join(" → ");
    const reasonBit = reason ? ` · ${reason}` : "";
    appendGameLog(
      `<span class="cn-log__label">Blue (you)</span> · clue <strong>${currentClue} ${currentNumber}</strong> · allowance <strong>${allowance}</strong> guesses · flipped <strong>${currentHumanTurnPicks.length}</strong>${reasonBit}: ${seq}`
    );
    currentHumanTurnPicks = [];
  }

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

  /** After game over, show every card’s true color (server sends key, or spymaster fallback). */
  function applyFullRevealAfterGame(fullRevealFromServer) {
    if (fullRevealFromServer && typeof fullRevealFromServer === "object") {
      for (const [k, v] of Object.entries(fullRevealFromServer)) {
        const i = parseInt(k, 10);
        if (i >= 0 && i < 25 && ["blue", "red", "neutral", "assassin"].includes(v)) {
          revealed[i] = v;
        }
      }
      return;
    }
    if (keyAssignment && validateKeyAssignment(keyAssignment)) {
      for (let i = 0; i < 25; i++) {
        revealed[i] = keyAssignment[i];
      }
    }
  }

  /** API / JSON may send index as string; steps must still drive guesser borders. */
  function stepBoardIndex(s) {
    const n = Number(s && s.index);
    return Number.isInteger(n) && n >= 0 && n < 25 ? n : null;
  }

  function applyStepsToRevealedBy(steps, team) {
    if (!steps || !steps.length) return;
    for (const s of steps) {
      const ix = stepBoardIndex(s);
      if (ix !== null) revealedBy[ix] = team;
    }
  }

  /** If steps omit indices, infer who flipped each newly revealed tile this response. */
  function fillRevealedByForNewTiles(prev, next, team) {
    for (let i = 0; i < 25; i++) {
      if (prev[i] || !next[i]) continue;
      if (revealedBy[i] == null) revealedBy[i] = team;
    }
  }

  function showHumanCluePanel() {
    if (els.humanCluePanel) els.humanCluePanel.hidden = false;
  }

  function hideHumanCluePanel() {
    if (els.humanCluePanel) els.humanCluePanel.hidden = true;
  }

  function setCheatPanelOpen(open) {
    if (!els.spoilerPanel || !els.cheatToggle) return;
    els.spoilerPanel.hidden = !open;
    els.cheatToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /** Cheat / linked words stay hidden until the player uses the discreet control under the board. */
  function updateOperativeSpoiler(wordList) {
    if (!els.spoilerPanel || !els.spoilerWords) return;
    if (humanRole !== "operative") {
      els.spoilerPanel.hidden = true;
      els.spoilerWords.textContent = "";
      if (els.cheatToggle) {
        els.cheatToggle.hidden = true;
        els.cheatToggle.setAttribute("aria-expanded", "false");
      }
      return;
    }
    if (!wordList || !wordList.length) {
      els.spoilerPanel.hidden = true;
      els.spoilerWords.textContent = "";
      if (els.cheatToggle) {
        els.cheatToggle.hidden = true;
        els.cheatToggle.setAttribute("aria-expanded", "false");
      }
      return;
    }
    if (els.spoilerLabel) {
      els.spoilerLabel.textContent = "Linked words (cheat)";
    }
    els.spoilerWords.textContent = wordList.map((w) => String(w).toUpperCase()).join(" · ");
    if (els.cheatToggle) els.cheatToggle.hidden = false;
    setCheatPanelOpen(false);
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

  function validateKeyAssignment(a) {
    if (!Array.isArray(a) || a.length !== 25) return false;
    const ok = new Set(["blue", "red", "neutral", "assassin"]);
    return a.every((x) => ok.has(x));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** @param {unknown} rows */
  function setSpymasterClueFitFromOperativeScores(rows) {
    spymasterClueFitByIndex = {};
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const ix = Number(row && row.index);
      const sc = Number(row && row.score);
      if (!Number.isInteger(ix) || ix < 0 || ix >= 25 || !Number.isFinite(sc)) continue;
      spymasterClueFitByIndex[ix] = Math.max(0, Math.min(100, Math.round(sc)));
    }
  }

  /**
   * Spymaster: reveal blue’s simulated picks one at a time (server order = clue-fit score, high first).
   * @param {Record<number, string>} prevRevealed
   * @param {object} res blue-operate JSON
   */
  async function animateSpymasterBlueSteps(prevRevealed, res) {
    const steps = Array.isArray(res.steps) ? res.steps : [];
    const finalRevealed = normalizeRevealed(res.revealed);
    const scoreMap = new Map();
    if (Array.isArray(res.operativeScores)) {
      for (const row of res.operativeScores) {
        const ix = Number(row.index);
        if (Number.isInteger(ix) && ix >= 0 && ix < 25) {
          scoreMap.set(ix, Number(row.score));
        }
      }
    }

    if (!steps.length) {
      revealed = finalRevealed;
      applyStepsToRevealedBy(res.steps, "blue");
      fillRevealedByForNewTiles(prevRevealed, revealed, "blue");
      return;
    }

    revealed = { ...prevRevealed };

    for (const s of steps) {
      const ix = stepBoardIndex(s);
      if (ix === null) continue;
      revealed[ix] = s.role;
      revealedBy[ix] = "blue";
      let sc = s.score != null ? Number(s.score) : NaN;
      if (!Number.isFinite(sc)) sc = scoreMap.get(ix);
      const label = s.word || words[ix] || "?";
      const scoreSuffix =
        Number.isFinite(sc) ? ` · clue fit <strong>${sc}</strong>/100` : "";
      setStatus(`Blue flips <strong>${label}</strong> (${s.role})${scoreSuffix}`);
      renderBoard();
      await sleep(620);
    }
    revealed = finalRevealed;
    applyStepsToRevealedBy(res.steps, "blue");
    fillRevealedByForNewTiles(prevRevealed, revealed, "blue");
    renderBoard();
  }

  function renderBoard() {
    if (!els.board) return;
    els.board.innerHTML = "";
    const spymasterKey =
      humanRole === "spymaster" &&
      keyAssignment &&
      validateKeyAssignment(keyAssignment);

    els.board.classList.toggle("cn-board--spymaster-key", !!spymasterKey);

    for (let i = 0; i < 25; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cn-cell";
      btn.dataset.index = String(i);
      const w = words[i] || "?";
      const r = revealed[i];

      if (spymasterKey) {
        const team = keyAssignment[i];
        btn.classList.add("cn-sm-" + team);
        const clueFit = spymasterClueFitByIndex[i];
        if (clueFit != null) {
          btn.textContent = "";
          const wordEl = document.createElement("span");
          wordEl.className = "cn-cell__word-cn";
          wordEl.textContent = w;
          btn.appendChild(wordEl);
          const fitEl = document.createElement("span");
          fitEl.className = "cn-cell__clue-fit";
          fitEl.textContent = String(clueFit);
          btn.appendChild(fitEl);
        } else {
          btn.textContent = w;
        }
        btn.disabled = true;
        if (r) {
          btn.classList.add("cn-cell--revealed-public");
          if (revealedBy[i] === "blue") btn.classList.add("cn-cell--guessed-blue");
          else if (revealedBy[i] === "red") btn.classList.add("cn-cell--guessed-red");
        }
        els.board.appendChild(btn);
        continue;
      }

      if (r) {
        btn.classList.add("cn-cell--" + r);
        btn.textContent = w;
        btn.disabled = true;
        if (revealedBy[i] === "blue") btn.classList.add("cn-cell--guessed-blue");
        else if (revealedBy[i] === "red") btn.classList.add("cn-cell--guessed-red");
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
      revealedBy[index] = "blue";
      guessesLeft -= 1;
      currentHumanTurnPicks.push({ word: res.word, role: res.role });
      if (res.gameOver) {
        logHumanBlueTurnEnd("game over");
        endGame(res.winner, res.winReason, res.fullReveal);
        return;
      }
      if (res.role !== "blue") {
        logHumanBlueTurnEnd("wrong color — turn ends");
        await runRedTurnAfterBlue("");
        return;
      }
      bluesThisTurn += 1;
      if (bluesThisTurn >= currentNumber) {
        setStatus(
          `<strong>Your guess:</strong> ${res.word} was <span class="cn-tag cn-tag--blue">blue</span> — that’s <strong>${currentNumber}</strong> for this clue. Ending your turn.`
        );
        renderBoard();
        logHumanBlueTurnEnd("found all blues for this clue");
        await runRedTurnAfterBlue("");
        return;
      }
      if (guessesLeft <= 0) {
        logHumanBlueTurnEnd("used full allowance");
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
      const prevRevealed = { ...revealed };
      const res = await api("/api/codenames/red-turn", { token, revealed });
      revealed = normalizeRevealed(res.revealed);
      applyStepsToRevealedBy(res.steps, "red");
      fillRevealedByForNewTiles(prevRevealed, revealed, "red");
      let msg = pre;
      msg += res.clue === "PASS" ? "Red passes." : `Red clue: <strong>${res.clue} ${res.number}</strong>`;
      if (res.steps && res.steps.length) {
        msg += "<br/>Red guessed: ";
        msg += res.steps.map((s) => `${s.word} (${s.role})`).join(" → ");
      }
      setStatus(msg);
      if (res.clue === "PASS") {
        appendGameLog(`<span class="cn-log__label">Red (sim)</span> · pass (no red words left)`);
      } else {
        const nFlip = res.steps && res.steps.length ? res.steps.length : 0;
        const seq =
          res.steps && res.steps.length
            ? res.steps.map((s) => `${s.word} (${s.role})`).join(" → ")
            : "—";
        appendGameLog(
          `<span class="cn-log__label">Red (sim)</span> · clue <strong>${res.clue} ${res.number}</strong> · cards flipped <strong>${nFlip}</strong>: ${seq}`
        );
      }
      if (res.gameOver) {
        endGame(res.winner, res.winReason, res.fullReveal);
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

  function endGameSummary(winner, winReason) {
    let headline = "Game over";
    let why = "";
    if (winner === "blue") {
      headline = "Blue wins";
      if (winReason === "all_blue_found") {
        why = "All nine blue words were revealed.";
      } else if (winReason === "assassin_by_red") {
        why = "The assassin was revealed while red was guessing — instant win for blue.";
      } else {
        why = "Blue wins the round.";
      }
    } else if (winner === "red") {
      headline = "Red wins";
      if (winReason === "all_red_found") {
        why = "All eight red words were revealed.";
      } else if (winReason === "assassin_by_blue") {
        why = "Blue revealed the assassin — instant win for red.";
      } else {
        why = "Red wins the round.";
      }
    }
    const keyNote = "Every card is face-up so you can see the full key.";
    const statusHtml = `<strong>${headline}.</strong> ${why ? `${why} ` : ""}<em>${keyNote}</em> Use <strong>← All games</strong> and open Codenames again for a new board.`;
    return { headline, why, statusHtml, keyNote };
  }

  function endGame(winner, winReason, fullRevealFromServer) {
    phase = "over";
    updateOperativeSpoiler(null);
    hideHumanCluePanel();
    hideOverlay();
    applyFullRevealAfterGame(fullRevealFromServer);
    /* Spymaster keeps seeing the key after game over. */
    renderBoard();
    const { headline, why, statusHtml, keyNote } = endGameSummary(winner, winReason);
    setStatus(statusHtml);
    const humanWon = winner === "blue";
    const detailWin = [why, keyNote].filter(Boolean).join(" ");
    const detailLoss = [`${headline} — ${why || "End of round."}`, keyNote].filter(Boolean).join(" ");
    void globalThis.GameResult?.show?.({
      won: humanWon,
      title: humanWon ? "You won!" : "You lost",
      detail: humanWon ? detailWin : detailLoss,
    });
  }

  async function startSession() {
    updateOperativeSpoiler(null);
    clearGameLog();
    currentHumanTurnPicks = [];
    hideOverlay();
    phase = "loading";
    setClue("—");
    hideHumanCluePanel();
    setStatus("Starting game…");
    renderBoard();
    try {
      const res = await fetch("/api/codenames/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ humanRole: humanRole || "operative" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      token = j.token;
      words = j.words;
      revealed = {};
      revealedBy = {};
      spymasterClueFitByIndex = {};
      bluesThisTurn = 0;
      if (humanRole === "spymaster") {
        if (!validateKeyAssignment(j.assignment)) {
          throw new Error(
            "Spymaster key missing from server — deploy the latest API (POST /api/codenames/new with humanRole)."
          );
        }
        keyAssignment = j.assignment;
      } else {
        keyAssignment = null;
      }

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
          "Blue spymaster — same <strong>themed 9 + 16 filler</strong> boards as operative. Enter your clue and number; <span class=\"cn-tag cn-tag--blue\">Gemini</span> plays operative. Red uses a fast local sim."
        );
        showHumanCluePanel();
        if (els.humanClue) els.humanClue.value = "";
        if (els.humanNumber) els.humanNumber.value = "1";
        renderBoard();
      }
    } catch (e) {
      keyAssignment = null;
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
        updateOperativeSpoiler(null);
        appendGameLog(`<span class="cn-log__label">Blue (AI spymaster)</span> · pass — no blue words left`);
        setStatus("No blue words left — ending your turn.");
        bluesThisTurn = 0;
        await runRedTurnAfterBlue("");
        return;
      }
      currentClue = res.clue;
      currentNumber = res.number;
      bluesThisTurn = 0;
      currentHumanTurnPicks = [];
      guessesLeft = res.number;
      setClue(`${res.clue} · ${res.number}`);
      updateOperativeSpoiler(Array.isArray(res.spoilerWords) ? res.spoilerWords : null);
      const clueLabel = res.openerPreset ? "Blue clue (curated)" : "Blue clue (AI)";
      appendGameLog(
        `<span class="cn-log__label">${clueLabel}</span> <strong>${res.clue} ${res.number}</strong> · allowance <strong>${guessesLeft}</strong> guesses. Turn ends after <strong>${currentNumber}</strong> correct blues or on a wrong color.`
      );
      setStatus(
        `Your clue: <strong>${res.clue} ${res.number}</strong>. You may guess up to <strong>${guessesLeft}</strong> words this turn (same as the clue number). Turn also ends after <strong>${currentNumber}</strong> correct blues or on a wrong color.`
      );
      phase = "humanGuess";
    } catch (e) {
      updateOperativeSpoiler(null);
      setStatus(
        `<span class="cn-err">${String(e.message)}</span><br/><small>Go back to <strong>All games</strong> and open Codenames again to retry.</small>`
      );
    }
    renderBoard();
  }

  async function submitHumanClue() {
    if (!token || phase !== "needHumanClue" || humanRole !== "spymaster") return;

    const rawClue = String(els.humanClue?.value || "").trim();
    const clue = rawClue
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/Ñ/gi, "N")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
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
      const prevRevealed = { ...revealed };
      const res = await api("/api/codenames/blue-operate", {
        token,
        revealed,
        clue: clue === "PASS" ? "PASS" : clue,
        number: num,
      });

      if (res.clue === "PASS" || res.number === 0) {
        spymasterClueFitByIndex = {};
        revealed = normalizeRevealed(res.revealed);
        applyStepsToRevealedBy(res.steps, "blue");
        fillRevealedByForNewTiles(prevRevealed, revealed, "blue");
      } else {
        setSpymasterClueFitFromOperativeScores(res.operativeScores);
        setStatus("Blue operative scored every card vs your clue; flipping highest first…");
        renderBoard();
        await animateSpymasterBlueSteps(prevRevealed, res);
      }

      let prefix = "";
      if (res.clue === "PASS" || res.number === 0) {
        setClue("PASS");
        prefix = "<strong>You passed.</strong> No guesses.";
        appendGameLog(`<span class="cn-log__label">Blue (you spymaster)</span> · <strong>PASS</strong> · no guesses`);
      } else {
        setClue(`${res.clue} · ${res.number}`);
        const allowance = res.guessAllowance ?? res.number;
        const planned = res.plannedGuessCount ?? 0;
        const played =
          typeof res.guessesPlayedCount === "number"
            ? res.guessesPlayedCount
            : Array.isArray(res.steps)
              ? res.steps.length
              : 0;
        const seq =
          res.steps && res.steps.length
            ? res.steps.map((s) => `${s.word} (${s.role})`).join(" → ")
            : "—";
        const warn =
          res.planIncomplete === true
            ? " · <em>warning: model did not return a full score list after retries</em>"
            : "";
        const scoreNote =
          Array.isArray(res.operativeScores) && res.operativeScores.length
            ? " · ranked <strong>all unrevealed</strong> by clue fit (0–100), flips follow that order (within turn rules)"
            : "";
        appendGameLog(
          `<span class="cn-log__label">Blue (Gemini operative)</span> · your clue <strong>${res.clue} ${res.number}</strong> · allowance <strong>${allowance}</strong> guesses · scored cells <strong>${planned}</strong> · cards flipped <strong>${played}</strong>${scoreNote}${warn}: ${seq}`
        );
        prefix = `Your clue: <strong>${res.clue} ${res.number}</strong> · allowance <strong>${allowance}</strong> guesses.`;
        if (res.steps && res.steps.length) {
          prefix += " Blue flipped (high clue-fit first): ";
          prefix += res.steps
            .map((s) =>
              s.score != null && Number.isFinite(Number(s.score))
                ? `${s.word} (${s.role}, ${s.score})`
                : `${s.word} (${s.role})`
            )
            .join(" → ");
        } else {
          prefix += " (no flips this turn.)";
        }
      }

      if (res.gameOver) {
        setStatus(prefix);
        endGame(res.winner, res.winReason, res.fullReveal);
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
        "You are the <strong>blue operative</strong>. Each board pairs a <strong>9-word blue theme</strong> with <strong>16 fixed filler</strong> words (shuffled). Up to <strong>five curated clues</strong> are tried in order; if any word tied to the next curated clue is already revealed, that clue is skipped and the next is used. When no curated clues remain, <strong>Gemini</strong> takes over. <strong>Bright blue border</strong> = blue guessed that card; <strong>bright red border</strong> = red guessed it. After clue <strong>N</strong>, you may guess up to <strong>N</strong> words. Red is simulated and never picks the assassin.";
    } else {
      els.intro.innerHTML =
        "You are the <strong>blue spymaster</strong>. Boards use the same <strong>random themed nine blues + paired fillers</strong> as operative mode (shuffled positions). The key: blue, red, tan (neutral), dark (assassin). A revealed word has a <strong>bright blue border</strong> if blue flipped it or <strong>bright red</strong> if red flipped it. Your number <strong>N</strong> is how many guesses blue gets this turn. Submit clue + number (or <strong>PASS</strong> + <strong>0</strong>). <strong>Gemini</strong> scores every unrevealed word vs your clue (0–100) and flips from highest score down (within turn rules). Red sim never picks the assassin.";
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
    els.overlay?.addEventListener("click", () => {
      if (els.overlay.classList.contains("cn-overlay--dismiss")) hideOverlay();
    });

    els.cheatToggle?.addEventListener("click", () => {
      if (humanRole !== "operative" || !els.spoilerPanel || !els.spoilerWords) return;
      if (!els.spoilerWords.textContent.trim()) return;
      setCheatPanelOpen(els.spoilerPanel.hidden);
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
