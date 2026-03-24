(function () {
  const startScreen = document.getElementById("imp-screen-start");
  const playScreen = document.getElementById("imp-screen-play");
  const voteScreen = document.getElementById("imp-screen-vote");
  const redeemScreen = document.getElementById("imp-screen-redeem");
  const resultScreen = document.getElementById("imp-screen-result");

  const statusStart = document.getElementById("imp-status-start");
  const statusPlay = document.getElementById("imp-status-play");
  const statusVote = document.getElementById("imp-status-vote");

  const roleCard = document.getElementById("imp-role-card");
  const orderLine = document.getElementById("imp-order-line");
  const turnLine = document.getElementById("imp-turn-line");
  const clueLog = document.getElementById("imp-clue-log");
  const inputRow = document.getElementById("imp-input-row");
  const clueInput = document.getElementById("imp-clue-input");
  const btnSubmitClue = document.getElementById("imp-btn-submit-clue");

  const voteGrid = document.getElementById("imp-vote-grid");
  const voteClueHistory = document.getElementById("imp-vote-clue-history");
  const btnSubmitVote = document.getElementById("imp-btn-submit-vote");
  const redeemLede = document.getElementById("imp-redeem-lede");
  const redeemClueHistory = document.getElementById("imp-redeem-clue-history");
  const redeemInputRow = document.getElementById("imp-redeem-input-row");
  const redeemInput = document.getElementById("imp-redeem-input");
  const btnRedeemSubmit = document.getElementById("imp-btn-redeem-submit");
  const statusRedeem = document.getElementById("imp-status-redeem");
  const resultCard = document.getElementById("imp-result-card");
  const round1Choice = document.getElementById("imp-round1-choice");
  const btnRound2 = document.getElementById("imp-btn-round2");
  const btnVoteEarly = document.getElementById("imp-btn-vote-early");

  /** @type {{token:string,order:number[],youAreImposter:boolean,secretWord:string|null,botNames:string[],clues:{seat:number,word:string,round:number,reasoning?:string}[],round2Started:boolean} | null} */
  let state = null;
  let selectedVote = null;
  /** @type {Record<string, unknown> | null} */
  let pendingRedeemVote = null;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function normalizeClueWord(raw) {
    const w = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return w.length >= 2 && w.length <= 32 ? w : null;
  }

  function normalizeRedeemGuess(raw) {
    const w = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    return w.length >= 2 && w.length <= 32 ? w : null;
  }

  function clueViolates(wordUpper, secretLower) {
    if (!secretLower) return null;
    const w = wordUpper.toLowerCase();
    const s = secretLower.toLowerCase();
    if (w === s) return "cannot be the secret word";
    if (w.includes(s) || s.includes(w)) return "cannot overlap the secret word like that";
    return null;
  }

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j, r };
  }

  function showScreen(which) {
    startScreen.hidden = which !== "start";
    playScreen.hidden = which !== "play";
    voteScreen.hidden = which !== "vote";
    if (redeemScreen) redeemScreen.hidden = which !== "redeem";
    resultScreen.hidden = which !== "result";
  }

  function renderOrderLine() {
    if (!state) return;
    const names = state.order.map((s) => state.botNames[s]).join(" → ");
    orderLine.textContent = `Speaking order each round: ${names}`;
  }

  function currentTurn() {
    const i = state.clues.length;
    if (i >= 8) return null;
    if (i === 4 && !state.round2Started) return null;
    const seat = state.order[i % 4];
    const round = i < 4 ? 1 : 2;
    return { seat, round, name: state.botNames[seat] };
  }

  function renderTurnLine() {
    if (!state) return;
    if (state.clues.length === 4 && !state.round2Started) {
      turnLine.textContent =
        "Round 1 complete — play a second round of clues, or vote now.";
      return;
    }
    const t = currentTurn();
    if (!t) {
      turnLine.textContent = "";
      return;
    }
    turnLine.textContent = `Round ${t.round} — ${t.name}'s turn.`;
  }

  function renderCluesInto(ul, clues) {
    ul.innerHTML = "";
    clues.forEach((c) => {
      const li = document.createElement("li");
      li.className = "imp-clue-item";
      const head = document.createElement("div");
      head.className = "imp-clue-head";
      head.innerHTML = `<strong>${escapeHtml(state.botNames[c.seat])}</strong> (round ${c.round}): <span class="imp-clue-word">${escapeHtml(c.word)}</span>`;
      li.appendChild(head);
      if (c.reasoning) {
        const sub = document.createElement("p");
        sub.className = "imp-clue-reason";
        sub.textContent = c.reasoning;
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
  }

  function renderClueLog() {
    renderCluesInto(clueLog, state.clues);
  }

  function hideRound1Choice() {
    round1Choice.hidden = true;
  }

  function showRound1Choice() {
    round1Choice.hidden = false;
    renderTurnLine();
    inputRow.hidden = true;
    clueInput.disabled = true;
    btnSubmitClue.disabled = true;
    statusPlay.textContent = "";
  }

  function updatePlayUi() {
    renderTurnLine();
    renderClueLog();
    const t = currentTurn();
    if (!t) {
      inputRow.hidden = true;
      return;
    }
    if (t.seat === 0) {
      inputRow.hidden = false;
      clueInput.disabled = false;
      btnSubmitClue.disabled = false;
      clueInput.value = "";
      clueInput.focus();
    } else {
      inputRow.hidden = true;
    }
  }

  async function runBotChain() {
    while (state.clues.length < 8) {
      if (state.clues.length === 4 && !state.round2Started) {
        showRound1Choice();
        return;
      }

      const next = state.order[state.clues.length % 4];
      if (next === 0) break;

      statusPlay.textContent = `${state.botNames[next]} is thinking…`;
      btnSubmitClue.disabled = true;
      clueInput.disabled = true;

      const { ok, j } = await apiPost("/api/imposter/bot-clue", {
        token: state.token,
        clues: state.clues,
      });

      if (!ok) {
        statusPlay.textContent = j.error || "Bot failed";
        throw new Error(j.error || "Bot clue failed");
      }

      state.clues.push({
        seat: j.seat,
        word: j.word,
        round: j.round,
        reasoning: j.reasoning || "",
      });
      renderClueLog();
      renderTurnLine();
    }

    statusPlay.textContent = "";
    if (state.clues.length === 8) {
      hideRound1Choice();
      openVote();
    } else {
      updatePlayUi();
    }
  }

  function openVote() {
    hideRound1Choice();
    showScreen("vote");
    selectedVote = null;
    btnSubmitVote.disabled = true;
    statusVote.textContent = "";
    if (voteClueHistory && state) {
      renderCluesInto(voteClueHistory, state.clues);
    }
    voteGrid.innerHTML = "";
    [1, 2, 3].forEach((seat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "imp-vote-btn";
      btn.textContent = state.botNames[seat];
      btn.dataset.seat = String(seat);
      btn.addEventListener("click", () => {
        selectedVote = seat;
        voteGrid.querySelectorAll(".imp-vote-btn").forEach((b) => b.classList.remove("imp-vote-btn--on"));
        btn.classList.add("imp-vote-btn--on");
        btnSubmitVote.disabled = false;
      });
      voteGrid.appendChild(btn);
    });
  }

  async function submitVote() {
    if (selectedVote == null) return;
    btnSubmitVote.disabled = true;
    statusVote.textContent = "Tallying votes…";

    const { ok, j } = await apiPost("/api/imposter/bot-vote", {
      token: state.token,
      clues: state.clues,
      userVote: selectedVote,
    });

    if (!ok) {
      statusVote.textContent = j.error || "Vote failed";
      btnSubmitVote.disabled = false;
      return;
    }

    if (j.redemptionNeeded) {
      pendingRedeemVote = j;
      openRedeemPhase(j);
      return;
    }

    showFinalResults(j, null);
  }

  function openRedeemPhase(voteJ) {
    showScreen("redeem");
    statusRedeem.textContent = "";
    redeemInput.value = "";
    if (redeemClueHistory && state) {
      renderCluesInto(redeemClueHistory, state.clues);
    }

    const impName = voteJ.imposterName;
    const isHumanImposter = state.youAreImposter && voteJ.imposterSeat === 0;

    if (isHumanImposter) {
      redeemLede.innerHTML = `You were voted out as <strong>${escapeHtml(impName)}</strong> (the Imposter). Guess the secret word in <strong>one</strong> try — if you’re right, you still win.`;
      redeemInputRow.hidden = false;
      redeemInput.disabled = false;
      btnRedeemSubmit.disabled = false;
      redeemInput.focus();
    } else {
      redeemLede.innerHTML = `<strong>${escapeHtml(impName)}</strong> was the Imposter and has one chance to guess the word from the clues.`;
      redeemInputRow.hidden = true;
      redeemInput.disabled = true;
      btnRedeemSubmit.disabled = true;
      runBotRedeem();
    }
  }

  async function runBotRedeem() {
    if (!pendingRedeemVote || !state) return;
    statusRedeem.textContent = `${state.botNames[pendingRedeemVote.imposterSeat]} is thinking of their best guess…`;
    const { ok, j } = await apiPost("/api/imposter/redeem", {
      redeemTicket: pendingRedeemVote.redeemTicket,
      token: state.token,
      clues: state.clues,
    });
    if (!ok) {
      statusRedeem.textContent = j.error || "Redemption failed";
      return;
    }
    statusRedeem.textContent = "";
    showFinalResults(pendingRedeemVote, j);
  }

  async function submitHumanRedeem() {
    if (!pendingRedeemVote || !state) return;
    const g = normalizeRedeemGuess(redeemInput.value);
    if (!g) {
      statusRedeem.textContent = "Enter one word (letters only, 2–32 characters).";
      return;
    }
    btnRedeemSubmit.disabled = true;
    redeemInput.disabled = true;
    statusRedeem.textContent = "Checking…";
    const { ok, j } = await apiPost("/api/imposter/redeem", {
      redeemTicket: pendingRedeemVote.redeemTicket,
      token: state.token,
      clues: state.clues,
      guess: g,
    });
    if (!ok) {
      statusRedeem.textContent = j.error || "Redemption failed";
      btnRedeemSubmit.disabled = false;
      redeemInput.disabled = false;
      return;
    }
    statusRedeem.textContent = "";
    showFinalResults(pendingRedeemVote, j);
  }

  /**
   * @param {Record<string, unknown>} voteJ
   * @param {Record<string, unknown> | null} redeemJ
   */
  function showFinalResults(voteJ, redeemJ) {
    const secretWord = redeemJ
      ? redeemJ.secretWord
      : voteJ.secretWord;
    let lead;
    if (redeemJ) {
      lead = redeemJ.imposterStoleWin
        ? "Imposter stole the win!"
        : "Innocents win!";
    } else {
      lead = voteJ.innocentsWin ? "Innocents win!" : "Imposter wins!";
    }

    const lines = [
      `<p class="imp-result-lead">${lead}</p>`,
      `<p>The secret word was <strong>${escapeHtml(String(secretWord || ""))}</strong>.</p>`,
      `<p>The Imposter was <strong>${escapeHtml(String(voteJ.imposterName || ""))}</strong>.</p>`,
      `<p>Eliminated: <strong>${escapeHtml(String(voteJ.eliminatedName || ""))}</strong>.</p>`,
    ];

    if (redeemJ) {
      const correct = redeemJ.redemptionCorrect;
      const g = redeemJ.redemptionGuess;
      const who = voteJ.imposterName;
      lines.push(
        `<p class="imp-result-redeem">${escapeHtml(String(who))} guessed <strong>${escapeHtml(String(g || ""))}</strong> — ${correct ? "correct; imposter wins." : "wrong; innocents take the round."}</p>`
      );
      if (redeemJ.redemptionReasoning && voteJ.imposterSeat !== 0) {
        lines.push(
          `<p class="imp-result-redeem-reason"><em>${escapeHtml(String(redeemJ.redemptionReasoning))}</em></p>`
        );
      }
    }

    lines.push(
      `<p class="imp-result-votes">Votes: You → ${escapeHtml(state.botNames[selectedVote])}. ` +
        voteJ.botVotes.map((b) => `${escapeHtml(b.name)} → ${escapeHtml(state.botNames[b.vote])}`).join(". ") +
        `</p>`
    );

    const details = document.createElement("div");
    details.className = "imp-result-details";
    details.innerHTML = "<p class=\"imp-result-sub\">How bots voted (reasoning):</p>";
    voteJ.botVotes.forEach((b) => {
      const p = document.createElement("p");
      p.className = "imp-bot-vote-reason";
      p.innerHTML = `<strong>${escapeHtml(b.name)}</strong> voted ${escapeHtml(state.botNames[b.vote])}: ${escapeHtml(b.reasoning || "")}`;
      details.appendChild(p);
    });

    resultCard.innerHTML = lines.join("");
    resultCard.appendChild(details);
    pendingRedeemVote = null;
    showScreen("result");
  }

  document.getElementById("imp-btn-start").addEventListener("click", async () => {
    statusStart.textContent = "Starting…";
    try {
      const { ok, j } = await apiPost("/api/imposter/new", {});
      if (!ok) throw new Error(j.error || "Could not start");
      state = {
        token: j.token,
        order: j.order,
        youAreImposter: j.youAreImposter,
        secretWord: j.secretWord,
        botNames: j.botNames,
        clues: [],
        round2Started: false,
      };
      roleCard.innerHTML = state.youAreImposter
        ? "<p><strong>You are the Imposter.</strong> You do <em>not</em> know the secret word. Listen to the clues and blend in.</p>"
        : `<p><strong>You are Innocent.</strong> The secret word is <strong>${escapeHtml(state.secretWord || "")}</strong>.</p>`;
      renderOrderLine();
      showScreen("play");
      statusStart.textContent = "";
      statusPlay.textContent = "";
      renderClueLog();
      await runBotChain();
    } catch (e) {
      statusStart.textContent = String(e.message);
    }
  });

  clueInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnSubmitClue.click();
    }
  });

  btnSubmitClue.addEventListener("click", async () => {
    if (!state) return;
    const t = currentTurn();
    if (!t || t.seat !== 0) return;

    const w = normalizeClueWord(clueInput.value);
    if (!w) {
      statusPlay.textContent = "Enter one word (letters only, 2–32 characters).";
      return;
    }
    if (!state.youAreImposter) {
      const bad = clueViolates(w, state.secretWord);
      if (bad) {
        statusPlay.textContent = `Invalid clue: ${bad}.`;
        return;
      }
    }

    statusPlay.textContent = "";
    state.clues.push({ seat: 0, word: w, round: t.round });
    renderClueLog();
    renderTurnLine();
    clueInput.value = "";

    try {
      await runBotChain();
    } catch (e) {
      statusPlay.textContent = String(e.message);
    }
  });

  btnSubmitVote.addEventListener("click", submitVote);

  if (redeemInput && btnRedeemSubmit) {
    redeemInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnRedeemSubmit.click();
      }
    });
    btnRedeemSubmit.addEventListener("click", () => {
      submitHumanRedeem();
    });
  }

  btnRound2.addEventListener("click", async () => {
    if (!state || state.clues.length !== 4 || state.round2Started) return;
    state.round2Started = true;
    hideRound1Choice();
    statusPlay.textContent = "";
    updatePlayUi();
    try {
      await runBotChain();
    } catch (e) {
      statusPlay.textContent = String(e.message);
    }
  });

  btnVoteEarly.addEventListener("click", () => {
    if (!state || state.clues.length !== 4) return;
    openVote();
  });

  document.getElementById("imp-btn-again").addEventListener("click", () => {
    state = null;
    pendingRedeemVote = null;
    clueLog.innerHTML = "";
    if (voteClueHistory) voteClueHistory.innerHTML = "";
    if (redeemClueHistory) redeemClueHistory.innerHTML = "";
    hideRound1Choice();
    resultCard.innerHTML = "";
    showScreen("start");
    statusStart.textContent = "";
    if (statusRedeem) statusRedeem.textContent = "";
  });
})();
