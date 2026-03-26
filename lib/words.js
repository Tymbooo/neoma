/**
 * Board word pool: triple the original 396-word core (~1188 unique words).
 * Sources: wordsCore, horsepaste JSON (English packs + others), hbiede CSV.
 * Only single-token A–Z strings (no multi-word clues-as-cards).
 */
const fs = require("fs");
const path = require("path");
const core = require("./wordsCore");

const DATA_DIR = path.join(__dirname, "data");
const HORSEPASTE_PATH = path.join(DATA_DIR, "horsepaste-words.json");
const CSV_PATH = path.join(DATA_DIR, "codenames-extra.csv");

/** Blocked tokens from Deep Undercover (adults-only); keep the rest for variety. */
const DEEP_UNDERCOVER_BLOCK = new Set(
  `ASS,ANAL,AREOLA,BALLS,BANG,BDSM,BIMBO,BLOW,BLOWJOB,BONDAGE,BOOB,BOOBS,BONER,BOOTY,BRA,BUTT,BUTTHOLE,CLIT,COCK,COCKS,COCKTAIL,CRACK,CUM,CUMSHOT,CUNT,DICK,DILDO,DOMINATRIX,DYKE,ERECT,EROTIC,FETISH,FUCK,GANGBANG,GIGOLO,HANDJOB,HARDON,HENTAI,HORNY,HUMP,JIZZ,JUGS,KINKY,LICK,LINGERIE,LUBE,MILF,MOLEST,NIPPLE,NUDE,ORGY,ORGASM,PECKER,PENIS,PERV,PHALLUS,PISS,PIMP,PORN,PUSSY,QUEEF,QUEER,RAPE,RAPEY,RIMJOB,SCREW,SCROTUM,SEMEN,SHIT,SLUT,SLUTTY,SMEGMA,SODOMY,SPANK,SQUIRT,STRIPPER,TEABAG,THREESOME,TITS,TITTY,TWAT,VAGINA,VOYEUR,WANK,WHORE`
    .split(",")
);

function asciiBoardToken(raw) {
  const s = String(raw).trim();
  if (!/^[a-zA-Z]+$/.test(s)) return null;
  const t = s.toUpperCase();
  if (t.length < 2 || t.length > 24) return null;
  return t;
}

function loadHorsepaste() {
  const raw = fs.readFileSync(HORSEPASTE_PATH, "utf8");
  return JSON.parse(raw);
}

function loadCsvLines() {
  return fs.readFileSync(CSV_PATH, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function buildPool() {
  const target = core.length * 3;
  const seen = new Set();
  const out = [];

  function add(t) {
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  }

  for (const w of core) add(w);

  function consumeArray(arr, blockSet) {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (out.length >= target) return;
      const t = asciiBoardToken(raw);
      if (!t) continue;
      if (blockSet && blockSet.has(t)) continue;
      add(t);
    }
  }

  const hp = loadHorsepaste();
  const skipLater = new Set([
    "English (Original)",
    "English (Duet)",
    "English (Deep Undercover) [MA]",
  ]);

  consumeArray(hp["English (Original)"]);
  consumeArray(hp["English (Duet)"]);
  consumeArray(loadCsvLines());
  consumeArray(hp["English (Deep Undercover) [MA]"], DEEP_UNDERCOVER_BLOCK);

  for (const key of Object.keys(hp).sort()) {
    if (out.length >= target) break;
    if (skipLater.has(key)) continue;
    consumeArray(hp[key]);
  }

  if (out.length < target) {
    throw new Error(
      `words.js: pool too small (${out.length} < ${target}). Add data or relax filters.`
    );
  }

  return out.slice(0, target);
}

module.exports = buildPool();
