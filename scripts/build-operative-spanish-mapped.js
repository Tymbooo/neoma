/**
 * Rebuild data/codenames-operative-puzzles.json from English backup + Spanish word pool.
 * Maps sorted English tokens 1:1 to Spanish tokens (400 from sagelga + extras).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EN_PATH = path.join(ROOT, "data", "codenames-operative-puzzles.en.json");
const RAW_ES = path.join(ROOT, "data", "es-codenames-wordlist-raw.txt");
const OUT_PATH = path.join(ROOT, "data", "codenames-operative-puzzles.json");

function normToken(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/Ñ/g, "N")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function loadSpanishPool() {
  const raw = fs.readFileSync(RAW_ES, "utf8").trim().split(/\n/);
  const fromFile = [...new Set(raw.map(normToken).filter((w) => w.length >= 2))];
  const extras = [
    "NOPAL",
    "CHOZA",
    "PLUMA",
    "SUERO",
    "MANTA",
    "RUEDA",
    "CUERO",
    "CEBOLLA",
    "TRIGO",
    "LAPIZ",
    "NORIA",
    "CIDRA",
    "POLVO",
    "BRUMA",
    "SONDA",
    "CINTA",
    "GOMA",
    "MANTEL",
    "PELUCHE",
    "ESPEJO",
    "RIVAL",
    "DUDA",
    "FAMA",
    "GLORIA",
    "PENA",
    "RABIA",
    "GOZO",
    "DOLOR",
    "CALOR",
    "FRIO",
    "SUENO",
    "SOPA",
    "TORTA",
    "RUMOR",
    "YERBA",
    "YUGO",
    "ZARZA",
    "ZORRO",
  ].map(normToken);
  const pool = [];
  const seen = new Set();
  for (const w of [...fromFile, ...extras]) {
    if (seen.has(w)) continue;
    seen.add(w);
    pool.push(w);
  }
  return pool;
}

function collectEnglishTokens(puzzles) {
  const s = new Set();
  for (const z of puzzles) {
    z.blues.forEach((w) => s.add(w));
    z.fillers.forEach((w) => s.add(w));
    z.presetClues.forEach((c) => {
      s.add(c.clue);
      c.targets.forEach((t) => s.add(t));
    });
  }
  return [...s].sort();
}

function buildMap(enTokens, esPool) {
  if (esPool.length < enTokens.length) {
    throw new Error(`Spanish pool too small: ${esPool.length} < ${enTokens.length}`);
  }
  const map = {};
  for (let i = 0; i < enTokens.length; i++) {
    map[enTokens[i]] = esPool[i];
  }
  /** Sorted-merge can assign unusable short clues (e.g. BEAM → "As" → AS). Force safe tokens. */
  const manual = {
    BEAM: "VIGA",
  };
  for (const [en, es] of Object.entries(manual)) {
    if (map[en]) map[en] = es;
  }
  return map;
}

function translatePuzzle(p, map) {
  return {
    blues: p.blues.map((w) => map[w]),
    fillers: p.fillers.map((w) => map[w]),
    presetClues: p.presetClues.map((c) => ({
      clue: map[c.clue],
      number: c.number,
      targets: c.targets.map((t) => map[t]),
    })),
  };
}

function assertPuzzle(p, idx) {
  const all = [...p.blues, ...p.fillers];
  const u = new Set(all);
  if (u.size !== 25) throw new Error(`puzzle ${idx}: need 25 unique board words, got ${u.size}`);
  const b = new Set(p.blues.map(normToken));
  for (const f of p.fillers) {
    const F = normToken(f);
    if (b.has(F)) throw new Error(`puzzle ${idx}: filler ${F} collides with blue`);
  }
  if (!Array.isArray(p.presetClues) || p.presetClues.length !== 5) {
    throw new Error(`puzzle ${idx}: need 5 preset clues`);
  }
}

function main() {
  const enPuzzles = JSON.parse(fs.readFileSync(EN_PATH, "utf8"));
  const enTokens = collectEnglishTokens(enPuzzles);
  const esPool = loadSpanishPool();
  const map = buildMap(enTokens, esPool);
  const out = enPuzzles.map((p, i) => {
    const q = translatePuzzle(p, map);
    assertPuzzle(q, i);
    return q;
  });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  fs.writeFileSync(
    path.join(ROOT, "data", "codenames-en-to-es-token-map.generated.json"),
    JSON.stringify(map, null, 2)
  );
  console.log("Wrote", OUT_PATH, "puzzles", out.length, "map keys", Object.keys(map).length);
}

main();
