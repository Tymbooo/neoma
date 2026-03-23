(function () {
  const WORDS = [
    "EXPROBABLE",
    "HOSTINGER",
    "SEARCH",
    "PUZZLE",
    "GAMES",
    "CURSOR",
    "NEOMA",
    "DOMAIN",
  ];

  /** Multiple choice: correct meaning + three distractors per grid word */
  const QUIZ = {
    EXPROBABLE: {
      question: "Which meaning fits this (site) name best?",
      correct:
        "Something highly likely — like “exponential” meets “probable”",
      wrong: [
        "A legal contract clause only used in the EU",
        "A technical term for CPU cache size",
        "A file extension for 3D models",
      ],
    },
    HOSTINGER: {
      question: "Hostinger is best known as:",
      correct: "A company that provides web hosting and domains",
      wrong: [
        "A video streaming codec",
        "A built-in macOS backup tool",
        "A type of SSL certificate brand",
      ],
    },
    SEARCH: {
      question: "In everyday language, “search” means:",
      correct: "To look carefully for someone or something",
      wrong: [
        "To encrypt a password",
        "To delete temporary files",
        "To increase screen brightness",
      ],
    },
    PUZZLE: {
      question: "A puzzle is usually:",
      correct: "A problem or game designed to challenge your thinking",
      wrong: [
        "A background image on your desktop",
        "A social media notification sound",
        "A browser bookmark folder",
      ],
    },
    GAMES: {
      question: "Games are typically:",
      correct: "Activities people play for fun, challenge, or competition",
      wrong: [
        "System updates for your phone",
        "Spreadsheet formulas",
        "Email attachment limits",
      ],
    },
    CURSOR: {
      question: "On a computer, a cursor often refers to:",
      correct:
        "The pointer or blinking mark that shows where you interact on screen",
      wrong: [
        "The computer’s power supply",
        "A list of Wi‑Fi networks",
        "The maximum zoom level in a map app",
      ],
    },
    NEOMA: {
      question: "In this project, “Neoma” is:",
      correct: "The workspace / project codename you’re building this site in",
      wrong: [
        "A standard unit for measuring RAM speed",
        "An official ISO date format",
        "A default filename for exports from Photoshop",
      ],
    },
    DOMAIN: {
      question: "A domain (like exprobable.com) is:",
      correct: "A human-readable name that points to a place on the internet",
      wrong: [
        "The physical data cable in your wall",
        "Your email inbox storage quota only",
        "A single webpage’s scroll position",
      ],
    },
  };

  const ROWS = 10;
  const COLS = 10;

  const DIRS = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randomLetter() {
    return String.fromCharCode(65 + Math.floor(Math.random() * 26));
  }

  function buildGrid(words) {
    const grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => "")
    );
    const placed = [];

    function startBounds(dr, dc, len) {
      let rLo = 0;
      let rHi = ROWS - 1;
      let cLo = 0;
      let cHi = COLS - 1;
      for (let i = 0; i < len; i++) {
        rLo = Math.max(rLo, -dr * i);
        rHi = Math.min(rHi, ROWS - 1 - dr * i);
        cLo = Math.max(cLo, -dc * i);
        cHi = Math.min(cHi, COLS - 1 - dc * i);
      }
      return { rLo, rHi, cLo, cHi };
    }

    for (const word of words) {
      const w = word.toUpperCase();
      const attempts = 120;
      let ok = false;
      for (let n = 0; n < attempts && !ok; n++) {
        const dir = DIRS[Math.floor(Math.random() * DIRS.length)];
        const [dr, dc] = dir;
        const len = w.length;
        const { rLo, rHi, cLo, cHi } = startBounds(dr, dc, len);
        if (rLo > rHi || cLo > cHi) continue;
        const r0 = rLo + Math.floor(Math.random() * (rHi - rLo + 1));
        const c0 = cLo + Math.floor(Math.random() * (cHi - cLo + 1));
        let fits = true;
        for (let i = 0; i < len; i++) {
          const r = r0 + dr * i;
          const c = c0 + dc * i;
          const ch = grid[r][c];
          if (ch !== "" && ch !== w[i]) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        for (let i = 0; i < len; i++) {
          const r = r0 + dr * i;
          const c = c0 + dc * i;
          grid[r][c] = w[i];
        }
        placed.push({
          word: w,
          cells: w.split("").map((_, i) => ({ r: r0 + dr * i, c: c0 + dc * i })),
        });
        ok = true;
      }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === "") grid[r][c] = randomLetter();
      }
    }

    return { grid, placed };
  }

  function cellsOnLine(r0, c0, r1, c1) {
    if (r0 === r1 && c0 === c1) return [{ r: r0, c: c0 }];
    const dr = r1 - r0;
    const dc = c1 - c0;

    if (r0 === r1) {
      const step = dc > 0 ? 1 : -1;
      const out = [];
      for (let c = c0; step > 0 ? c <= c1 : c >= c1; c += step)
        out.push({ r: r0, c });
      return out;
    }
    if (c0 === c1) {
      const step = dr > 0 ? 1 : -1;
      const out = [];
      for (let r = r0; step > 0 ? r <= r1 : r >= r1; r += step)
        out.push({ r, c: c0 });
      return out;
    }
    if (Math.abs(dr) === Math.abs(dc)) {
      const sr = dr > 0 ? 1 : -1;
      const sc = dc > 0 ? 1 : -1;
      const out = [];
      for (let i = 0; i <= Math.abs(dr); i++)
        out.push({ r: r0 + sr * i, c: c0 + sc * i });
      return out;
    }
    return null;
  }

  function key(r, c) {
    return r + "," + c;
  }

  function getQuiz(word) {
    const q = QUIZ[word];
    if (q) return q;
    return {
      question: "Which option best describes this word?",
      correct: "A themed word from this puzzle",
      wrong: [
        "Unrelated tech jargon",
        "A random place name",
        "A cooking measurement",
      ],
    };
  }

  function init() {
    const gridEl = document.getElementById("word-grid");
    const listEl = document.getElementById("word-list");
    const progressEl = document.getElementById("wordsearch-progress");
    const winEl = document.getElementById("wordsearch-win");
    const modalEl = document.getElementById("word-quiz-modal");
    const promptEl = document.getElementById("word-quiz-prompt");
    const wordEl = document.getElementById("word-quiz-word");
    const feedbackEl = document.getElementById("word-quiz-feedback");
    const choicesEl = document.getElementById("word-quiz-choices");

    if (!gridEl || !listEl || !modalEl || !choicesEl) return;

    const { grid, placed } = buildGrid(shuffle(WORDS));
    const wordSet = new Set(placed.map((p) => p.word));
    const foundWords = new Set();
    const foundCells = new Map();

    let quizOpen = false;
    let pendingWord = null;
    let pendingCells = null;
    let escapeHandler = null;

    const backdropEl = modalEl.querySelector(".word-quiz-backdrop");
    if (backdropEl) {
      backdropEl.addEventListener("click", () => {
        if (quizOpen) closeQuiz();
      });
    }

    const cellEls = [];
    for (let r = 0; r < ROWS; r++) {
      cellEls[r] = [];
      for (let c = 0; c < COLS; c++) {
        const div = document.createElement("div");
        div.className = "word-cell";
        div.textContent = grid[r][c];
        div.dataset.r = String(r);
        div.dataset.c = String(c);
        gridEl.appendChild(div);
        cellEls[r][c] = div;
      }
    }

    gridEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

    const listItems = new Map();
    for (const w of [...wordSet].sort()) {
      const li = document.createElement("li");
      li.textContent = w;
      li.dataset.word = w;
      listEl.appendChild(li);
      listItems.set(w, li);
    }

    function updateProgress() {
      const n = foundWords.size;
      const t = wordSet.size;
      progressEl.textContent = `Found ${n} / ${t} words`;
      if (n >= t && t > 0) {
        winEl.classList.add("visible");
      }
    }

    updateProgress();

    let dragStart = null;
    let selecting = [];

    function clearSelectingClass() {
      for (const { r, c } of selecting) {
        const el = cellEls[r][c];
        if (!foundCells.has(key(r, c))) el.classList.remove("selecting");
      }
      selecting = [];
    }

    function setSelecting(line) {
      clearSelectingClass();
      selecting = line;
      for (const { r, c } of line) {
        const el = cellEls[r][c];
        if (!foundCells.has(key(r, c))) el.classList.add("selecting");
      }
    }

    function readString(line) {
      return line.map(({ r, c }) => grid[r][c]).join("");
    }

    function markFound(word, cells) {
      if (foundWords.has(word)) return;
      foundWords.add(word);
      for (const { r, c } of cells) {
        const k = key(r, c);
        foundCells.set(k, true);
        cellEls[r][c].classList.remove("selecting");
        cellEls[r][c].classList.add("found");
      }
      const li = listItems.get(word);
      if (li) li.classList.add("found");
      updateProgress();
    }

    function closeQuiz() {
      quizOpen = false;
      pendingWord = null;
      pendingCells = null;
      document.body.classList.remove("word-quiz-open");
      modalEl.hidden = true;
      modalEl.setAttribute("aria-hidden", "true");
      choicesEl.innerHTML = "";
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("word-quiz-feedback--error");
      document.body.style.overflow = "";
      if (escapeHandler) {
        document.removeEventListener("keydown", escapeHandler);
        escapeHandler = null;
      }
    }

    function openQuiz(word, cells) {
      const spec = getQuiz(word);
      pendingWord = word;
      pendingCells = cells;
      quizOpen = true;

      promptEl.textContent = spec.question;
      wordEl.textContent = word;
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("word-quiz-feedback--error");

      const options = shuffle([
        { text: spec.correct, correct: true },
        ...spec.wrong.map((text) => ({ text, correct: false })),
      ]);

      choicesEl.innerHTML = "";
      for (const opt of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "word-quiz-choice";
        btn.textContent = opt.text;
        btn.dataset.correct = opt.correct ? "1" : "0";
        btn.addEventListener("click", () => {
          if (btn.dataset.correct === "1") {
            feedbackEl.textContent = "Correct — word cleared.";
            feedbackEl.classList.remove("word-quiz-feedback--error");
            markFound(pendingWord, pendingCells);
            closeQuiz();
          } else {
            feedbackEl.textContent = "Not quite — try another option.";
            feedbackEl.classList.add("word-quiz-feedback--error");
          }
        });
        choicesEl.appendChild(btn);
      }

      document.body.classList.add("word-quiz-open");
      modalEl.hidden = false;
      modalEl.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";

      escapeHandler = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeQuiz();
        }
      };
      document.addEventListener("keydown", escapeHandler);

      const first = choicesEl.querySelector(".word-quiz-choice");
      if (first) first.focus();
    }

    function tryMatch(line) {
      const s = readString(line);
      const rev = s.split("").reverse().join("");
      let word = null;
      if (wordSet.has(s) && s.length >= 3) word = s;
      else if (wordSet.has(rev) && rev.length >= 3) word = rev;
      if (!word) return;
      if (foundWords.has(word)) return;
      openQuiz(word, line);
    }

    function pointerToCell(target) {
      const el = target.closest(".word-cell");
      if (!el || !gridEl.contains(el)) return null;
      const r = parseInt(el.dataset.r, 10);
      const c = parseInt(el.dataset.c, 10);
      return { r, c, el };
    }

    gridEl.addEventListener("pointerdown", (e) => {
      if (quizOpen) return;
      const cell = pointerToCell(e.target);
      if (!cell) return;
      e.preventDefault();
      dragStart = { r: cell.r, c: cell.c };
      gridEl.setPointerCapture(e.pointerId);
      setSelecting([{ r: cell.r, c: cell.c }]);
    });

    gridEl.addEventListener("pointermove", (e) => {
      if (quizOpen || dragStart === null) return;
      const cell = pointerToCell(document.elementFromPoint(e.clientX, e.clientY));
      if (!cell) return;
      const line = cellsOnLine(dragStart.r, dragStart.c, cell.r, cell.c);
      if (line) setSelecting(line);
    });

    function endDrag() {
      if (dragStart === null) return;
      if (!quizOpen && selecting.length) tryMatch(selecting);
      clearSelectingClass();
      dragStart = null;
    }

    gridEl.addEventListener("pointerup", endDrag);
    gridEl.addEventListener("pointercancel", endDrag);
    gridEl.addEventListener("lostpointercapture", endDrag);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
