import {
  SPAIN_VIEW,
  OUTLINE_PATH,
  REGIONS,
  CITIES,
  RIVERS,
  RANGES,
  buildQuestionPool,
} from "./spain-geo-data.js";

const svgNs = "http://www.w3.org/2000/svg";
const CHOICE_KEYS = ["1", "2", "3", "4"];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else if (c) n.appendChild(c);
  }
  return n;
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(svgNs, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.setAttribute("class", v);
    else if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  return n;
}

function promptToHtml(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function lookupEntity(layer, id) {
  if (layer === "region") return REGIONS.find((r) => r.id === id);
  if (layer === "city") return CITIES.find((r) => r.id === id);
  if (layer === "river") return RIVERS.find((r) => r.id === id);
  if (layer === "range") return RANGES.find((r) => r.id === id);
  return null;
}

function renderEntityShape(layer, entity, color, interactive) {
  const stroke = color;
  const fill = color;
  const fillOp = layer === "region" ? 0.22 : layer === "range" ? 0.28 : layer === "city" ? 0.35 : 0;

  if (layer === "region" || layer === "range") {
    const e = entity;
    return svgEl("ellipse", {
      class: interactive ? "sg-hit" : "",
      cx: e.cx,
      cy: e.cy,
      rx: e.rx,
      ry: e.ry,
      fill: interactive ? fill : "none",
      "fill-opacity": interactive ? String(fillOp) : "0",
      stroke: interactive ? stroke : "rgba(255,255,255,0.08)",
      "stroke-width": interactive ? "2.5" : "0.6",
      "data-id": interactive ? e.id : "",
      "vector-effect": "non-scaling-stroke",
    });
  }
  if (layer === "city") {
    const c = entity;
    const r = c.r ?? 2;
    return svgEl("circle", {
      class: interactive ? "sg-hit" : "",
      cx: c.cx,
      cy: c.cy,
      r: String(r),
      fill: interactive ? fill : "rgba(255,255,255,0.15)",
      "fill-opacity": interactive ? "0.75" : "0.4",
      stroke: interactive ? stroke : "rgba(255,255,255,0.2)",
      "stroke-width": interactive ? "2" : "0.8",
      "data-id": interactive ? c.id : "",
    });
  }
  if (layer === "river") {
    const rv = entity;
    const pts = rv.points
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number))
      .map(([x, y]) => `${x},${y}`)
      .join(" ");
    return svgEl("polyline", {
      class: interactive ? "sg-hit" : "",
      points: pts,
      fill: "none",
      stroke: interactive ? stroke : "rgba(255,255,255,0.12)",
      "stroke-width": interactive ? "3.2" : "1",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "data-id": interactive ? rv.id : "",
    });
  }
  return null;
}

function main() {
  const pool = buildQuestionPool();
  const mapHost = document.getElementById("sg-map");
  const promptEl = document.getElementById("sg-prompt");
  const feedbackEl = document.getElementById("sg-feedback");
  const choicesEl = document.getElementById("sg-choices");
  const scoreEl = document.getElementById("sg-score");
  const nextBtn = document.getElementById("sg-next");
  const againBtn = document.getElementById("sg-again");

  if (!mapHost) return;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${SPAIN_VIEW.w} ${SPAIN_VIEW.h}`,
    class: "sg-svg",
    role: "img",
    "aria-label": "Schematic map of Spain",
  });

  const path = svgEl("path", {
    d: OUTLINE_PATH,
    class: "sg-outline-path",
  });
  svg.appendChild(path);

  const faint = svgEl("g", { class: "sg-faint" });
  for (const r of REGIONS) faint.appendChild(renderEntityShape("region", r, "#64748b", false));
  for (const c of CITIES) faint.appendChild(renderEntityShape("city", c, "#94a3b8", false));
  for (const rv of RIVERS) faint.appendChild(renderEntityShape("river", rv, "#64748b", false));
  for (const m of RANGES) faint.appendChild(renderEntityShape("range", m, "#475569", false));
  svg.appendChild(faint);

  const activeG = svgEl("g", { id: "sg-active-layer" });
  svg.appendChild(activeG);

  mapHost.appendChild(svg);

  let round = [];
  let qIndex = 0;
  let score = 0;
  let locked = false;
  /** @type {{ fn: (id: string) => void } | null} */
  let pickRef = { fn: null };

  function pickRound() {
    const copy = shuffle([...pool]);
    return copy.slice(0, 3);
  }

  function onKey(ev) {
    const idx = CHOICE_KEYS.indexOf(ev.key);
    if (idx === -1) return;
    const q = round[qIndex];
    if (!q || locked) return;
    if (idx < q.options.length && pickRef.fn) pickRef.fn(q.options[idx].id);
  }

  function renderChoices(question) {
    choicesEl.innerHTML = "";
    question.options.forEach((opt, i) => {
      const btn = el(
        "button",
        {
          type: "button",
          class: "sg-choice-btn",
          "data-id": opt.id,
        },
        [`${i + 1}. ${opt.label}`]
      );
      btn.style.borderColor = opt.color;
      btn.addEventListener("click", () => pickRef.fn && pickRef.fn(opt.id));
      choicesEl.appendChild(btn);
    });
  }

  function renderMap(question) {
    activeG.innerHTML = "";
    for (const opt of question.options) {
      const ent = lookupEntity(question.layer, opt.id);
      if (!ent) continue;
      const node = renderEntityShape(question.layer, ent, opt.color, true);
      if (node) {
        node.style.cursor = "pointer";
        node.addEventListener("click", () => pickRef.fn && pickRef.fn(opt.id));
        activeG.appendChild(node);
      }
    }
  }

  function showQuestion() {
    window.removeEventListener("keydown", onKey);
    locked = false;
    nextBtn.hidden = true;
    feedbackEl.textContent = "";
    feedbackEl.className = "sg-feedback";
    const q = round[qIndex];
    const correctId = q.correctId;

    promptEl.innerHTML = promptToHtml(q.prompt);
    renderMap(q);
    renderChoices(q);

    pickRef.fn = (id) => {
      if (locked) return;
      locked = true;
      window.removeEventListener("keydown", onKey);
      pickRef.fn = null;
      const ok = id === correctId;
      if (ok) {
        score++;
        feedbackEl.textContent = "Correct.";
        feedbackEl.className = "sg-feedback sg-feedback--ok";
      } else {
        const right = q.options.find((o) => o.id === correctId);
        feedbackEl.textContent = `Not quite — the answer was “${right?.label ?? ""}”.`;
        feedbackEl.className = "sg-feedback sg-feedback--bad";
      }
      scoreEl.textContent = `Score this round: ${score} / 3`;
      nextBtn.hidden = false;
      nextBtn.textContent = qIndex < 2 ? "Next question" : "See results";
    };

    window.addEventListener("keydown", onKey);
  }

  function finishRound() {
    window.removeEventListener("keydown", onKey);
    pickRef.fn = null;
    promptEl.innerHTML = `<strong>Round complete.</strong> You scored ${score} / 3.`;
    activeG.innerHTML = "";
    choicesEl.innerHTML = "";
    feedbackEl.textContent = "";
    nextBtn.hidden = true;
    againBtn.hidden = false;
  }

  nextBtn.addEventListener("click", () => {
    if (qIndex < 2) {
      qIndex++;
      showQuestion();
    } else {
      finishRound();
    }
  });

  againBtn.addEventListener("click", () => {
    round = pickRound();
    qIndex = 0;
    score = 0;
    scoreEl.textContent = "";
    againBtn.hidden = true;
    showQuestion();
  });

  function start() {
    round = pickRound();
    qIndex = 0;
    score = 0;
    scoreEl.textContent = "";
    againBtn.hidden = true;
    showQuestion();
  }

  start();
}

main();
