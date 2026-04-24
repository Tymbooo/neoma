(function () {
  const actionBtn = document.getElementById("np-action");
  const translateBtn = document.getElementById("np-translate");
  const out = document.getElementById("np-output");
  const quizEl = document.getElementById("np-quiz");
  const status = document.getElementById("np-status");
  const progressEl = document.getElementById("np-progress");

  let articles = [];
  let idx = 0;
  let phase = "intro";

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function setStatus(msg, kind) {
    status.textContent = msg || "";
    status.className = "np-status" + (kind ? " np-status--" + kind : "");
  }

  function setStatusHtml(html, kind) {
    status.innerHTML = html || "";
    status.className = "np-status" + (kind ? " np-status--" + kind : "");
  }

  function validateArticles(arts) {
    if (!Array.isArray(arts) || arts.length === 0) {
      return { ok: false, error: "No articles in response." };
    }
    for (let a = 0; a < arts.length; a++) {
      const art = arts[a];
      if (!art.lines || !art.question || !art.options || art.correct == null) {
        return { ok: false, error: "Invalid article shape." };
      }
      if (art.options.length !== 4) {
        return { ok: false, error: "Each article needs four answer options." };
      }
      for (let L = 0; L < art.lines.length; L++) {
        const ln = art.lines[L];
        if (!ln.es || !ln.en || ln.es.length !== ln.en.length) {
          return { ok: false, error: "Line length mismatch in article " + (a + 1) + "." };
        }
      }
    }
    return { ok: true };
  }

  function renderArticle(art) {
    const title = `<h2 class="np-article__title">${escapeHtml(art.title)}</h2>`;
    const lines = art.lines
      .map((line) => {
        const pairs = line.es
          .map((w, i) => {
            const es = escapeHtml(w);
            const en = escapeHtml(line.en[i] || "");
            return `<div class="np-pair"><span class="np-es">${es}</span><span class="np-en" aria-hidden="true">${en}</span></div>`;
          })
          .join("");
        return `<div class="np-line" role="group">${pairs}</div>`;
      })
      .join("");
    out.innerHTML = title + lines;
  }

  const GLOSS_PEEK_MS = 4200;

  function runGlossPeek() {
    const glosses = out.querySelectorAll(".np-en");
    if (!glosses.length) return;
    glosses.forEach((el) => el.classList.remove("np-en--peek"));
    void out.offsetWidth;
    glosses.forEach((el) => el.classList.add("np-en--peek"));
    translateBtn.disabled = true;
    window.setTimeout(() => {
      glosses.forEach((el) => el.classList.remove("np-en--peek"));
      translateBtn.disabled = false;
    }, GLOSS_PEEK_MS);
  }

  function setQuizFeedback(text, kind) {
    const el = quizEl.querySelector(".np-quiz__feedback");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "np-quiz__feedback";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = "np-quiz__feedback" + (kind ? " np-quiz__feedback--" + kind : "");
  }

  function renderQuiz(art) {
    quizEl.innerHTML =
      `<p class="np-quiz__q">${escapeHtml(art.question)}</p>` +
      `<div class="np-quiz__opts" role="group" aria-label="Choose an answer"></div>` +
      `<p class="np-quiz__feedback" role="status" aria-live="polite" hidden></p>`;
    const opts = quizEl.querySelector(".np-quiz__opts");
    art.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "np-quiz__opt";
      b.textContent = opt;
      b.addEventListener("click", () => onAnswer(i));
      opts.appendChild(b);
    });
    setQuizFeedback("", "");
  }

  function showRead() {
    phase = "read";
    const art = articles[idx];
    progressEl.hidden = false;
    progressEl.textContent = `Article ${idx + 1} of ${articles.length}`;
    out.hidden = false;
    quizEl.hidden = true;
    quizEl.innerHTML = "";
    actionBtn.hidden = false;
    actionBtn.textContent = "I've finished reading";
    translateBtn.hidden = false;
    renderArticle(art);
    setStatus("");
  }

  function showQuiz() {
    phase = "quiz";
    out.hidden = true;
    quizEl.hidden = false;
    actionBtn.hidden = true;
    translateBtn.hidden = true;
    renderQuiz(articles[idx]);
    setStatus("Pick the best answer. You’ll see right/wrong below the choices.");
  }

  function showComplete() {
    phase = "complete";
    progressEl.hidden = true;
    out.hidden = true;
    quizEl.hidden = true;
    actionBtn.hidden = false;
    actionBtn.textContent = "Play again";
    translateBtn.hidden = true;
    setStatus(
      articles.length === 1
        ? "You finished the article and every question."
        : "You finished all " + articles.length + " articles and every question.",
      ""
    );
    void globalThis.GameResult?.show?.({
      won: true,
      title: "Newsroom complete",
      detail: "You answered every comprehension question correctly. Claim your coin below.",
    });
  }

  function showIntro() {
    phase = "intro";
    idx = 0;
    articles = [];
    progressEl.hidden = true;
    out.hidden = true;
    out.innerHTML = "";
    quizEl.hidden = true;
    quizEl.innerHTML = "";
    actionBtn.hidden = false;
    actionBtn.textContent = "Start";
    translateBtn.hidden = true;
    setStatus("");
  }

  function onAnswer(choice) {
    const art = articles[idx];
    const buttons = quizEl.querySelectorAll(".np-quiz__opt");
    if (choice !== art.correct) {
      const btn = buttons[choice];
      if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.classList.add("np-quiz__opt--wrong");
      }
      setQuizFeedback("Not quite — that one’s wrong. Try another option.", "err");
      setStatus("");
      return;
    }
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === art.correct) btn.classList.add("np-quiz__opt--correct");
    });
    const last = idx + 1 >= articles.length;
    setQuizFeedback(last ? "Correct — you cleared the newsroom!" : "Correct — on to the next article.", "ok");
    setStatus("");
    window.setTimeout(() => {
      idx += 1;
      if (idx >= articles.length) showComplete();
      else showRead();
    }, 1100);
  }

  translateBtn.addEventListener("click", () => {
    if (phase !== "read" || out.hidden) return;
    runGlossPeek();
  });

  /** Slightly under Vercel `maxDuration` for this function (180s) so we surface an error instead of hanging. */
  const FETCH_EDITION_MS = 175000;

  async function fetchEdition() {
    const apiUrl = new URL("/api/newspaper", window.location.href).href;
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), FETCH_EDITION_MS);
    let r;
    try {
      r = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newsroom: true }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error(
          "Request timed out (this edition took too long). Try again in a moment, or ask your host to check XAI_API_KEY and xAI Responses / search tools."
        );
      }
      throw e;
    } finally {
      window.clearTimeout(timeoutId);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const parts = [j.error, j.hint].filter(Boolean);
      if (Array.isArray(j.tried) && j.tried.length) {
        parts.push("Tried models: " + j.tried.join(", "));
      }
      throw new Error(parts.join(" — ") || r.statusText);
    }
    const check = validateArticles(j.articles);
    if (!check.ok) {
      throw new Error(check.error);
    }
    return j;
  }

  actionBtn.addEventListener("click", async () => {
    if (phase === "intro") {
      actionBtn.disabled = true;
      setStatus("Fetching live tech news…", "busy");
      const longWaitTimer = window.setTimeout(() => {
        if (phase === "intro" && actionBtn.disabled) {
          setStatus(
            "Still working… Live search + JSON usually needs 30–120 seconds. If this times out, check XAI_API_KEY and tool access.",
            "busy"
          );
        }
      }, 22000);
      try {
        const j = await fetchEdition();
        articles = j.articles;
        let base = j.model ? "Edition ready (" + j.model + ")" : "Edition ready";
        if (j.usedLiveSearch) {
          if (j.usedWebSearch && j.usedXSearch) {
            base += " · live web + X search";
          } else if (j.usedXSearch) {
            base += " · X search";
          } else if (j.usedWebSearch) {
            base += " · web search";
          }
        }
        if (j.notice) {
          setStatusHtml(
            escapeHtml(base) + '<br/><span class="np-status--sub">' + escapeHtml(j.notice) + "</span>"
          );
        } else {
          setStatus(base);
        }
        showRead();
      } catch (e) {
        setStatus(String(e.message || e), "err");
      } finally {
        window.clearTimeout(longWaitTimer);
        actionBtn.disabled = false;
      }
      return;
    }
    if (phase === "read") {
      showQuiz();
      return;
    }
    if (phase === "complete") {
      showIntro();
    }
  });

  showIntro();
})();
