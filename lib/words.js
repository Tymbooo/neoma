/**
 * Board word pool for Codenames: English-only sources (core + English horsepaste packs + CSV).
 * Other-language packs (Albanian, German, etc.) are never merged.
 * Vulgar / sexual slang is blocked everywhere (including Deep Undercover leftovers).
 */
const fs = require("fs");
const path = require("path");
const core = require("./wordsCore");

const DATA_DIR = path.join(__dirname, "data");
const HORSEPASTE_PATH = path.join(DATA_DIR, "horsepaste-words.json");
const CSV_PATH = path.join(DATA_DIR, "codenames-extra.csv");

/** Blocked tokens from Deep Undercover (adults-only). */
const DEEP_UNDERCOVER_BLOCK = new Set(
  `ASS,ANAL,AREOLA,BALLS,BANG,BDSM,BIMBO,BLOW,BLOWJOB,BONDAGE,BOOB,BOOBS,BONER,BOOTY,BRA,BUTT,BUTTHOLE,CLIT,COCK,COCKS,COCKTAIL,CRACK,CUM,CUMSHOT,CUNT,DICK,DILDO,DOMINATRIX,DYKE,ERECT,EROTIC,FETISH,FUCK,GANGBANG,GIGOLO,HANDJOB,HARDON,HENTAI,HORNY,HUMP,JIZZ,JUGS,KINKY,LICK,LINGERIE,LUBE,MILF,MOLEST,NIPPLE,NUDE,ORGY,ORGASM,PECKER,PENIS,PERV,PHALLUS,PISS,PIMP,PORN,PUSSY,QUEEF,QUEER,RAPE,RAPEY,RIMJOB,SCREW,SCROTUM,SEMEN,SHIT,SLUT,SLUTTY,SMEGMA,SODOMY,SPANK,SQUIRT,STRIPPER,TEABAG,THREESOME,TITS,TITTY,TWAT,VAGINA,VOYEUR,WANK,WHORE`
    .split(",")
);

/** Extra crude tokens blocked on every source (e.g. Deep Undercover gaps, CSV). */
const BOARD_VULGAR_EXTRA = new Set(
  `MANBOOBS,BITCH,BREAST,DOUCHE,DOMINATE,GASH,GROPE,HOOKER,JOHNSON,JOYSTICK,KNOCKERS,MELONS,MISSIONARY,MOIST,MOTORBOAT,SHAFT,STRIP,TIT,VIBRATOR,FORESKIN,FIST,FACIAL,BENDER,THONG,WENCH,WIENER`
    .split(",")
);

const BLOCKED = new Set([...DEEP_UNDERCOVER_BLOCK, ...BOARD_VULGAR_EXTRA]);

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
  const seen = new Set();
  const out = [];

  function add(t) {
    if (!t || seen.has(t)) return;
    if (BLOCKED.has(t)) return;
    seen.add(t);
    out.push(t);
  }

  for (const w of core) add(w);

  function consumeArray(arr) {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      const t = asciiBoardToken(raw);
      if (!t) continue;
      add(t);
    }
  }

  const hp = loadHorsepaste();
  consumeArray(hp["English (Original)"]);
  consumeArray(hp["English (Duet)"]);
  consumeArray(loadCsvLines());
  consumeArray(hp["English (Deep Undercover) [MA]"]);

  const minSize = 25;
  if (out.length < minSize) {
    throw new Error(
      `words.js: pool too small (${out.length} < ${minSize}). Check English data and blocklists.`
    );
  }

  return out;
}

module.exports = buildPool();
