#!/usr/bin/env node
/**
 * Rebuilds data/codenames-curated-puzzles.json:
 * - Only the opener's words share a theme; other blues are unrelated.
 * - Grid order is shuffled (seeded) so colors don't cluster by row.
 */
const fs = require("fs");
const path = require("path");
const wordsCore = require("../lib/wordsCore");
const coreSet = new Set(wordsCore);

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shufflePairs(pairs, seed) {
  const rng = mulberry32(seed >>> 0);
  const a = pairs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPuzzle(spec) {
  const { clue, number, themeBlue, fillerBlue, red, neutral, assassin, seed } = spec;
  if (themeBlue.length !== number) throw new Error("themeBlue length must match clue number");
  if (fillerBlue.length !== 9 - themeBlue.length) throw new Error("need 9 blues total");
  if (red.length !== 8 || neutral.length !== 7) throw new Error("need 8 red, 7 neutral");

  const allWords = [...themeBlue, ...fillerBlue, ...red, ...neutral, assassin];
  const set = new Set(allWords.map((w) => w.toUpperCase()));
  if (set.size !== 25) throw new Error("duplicate or wrong count");
  for (const w of allWords) {
    if (!coreSet.has(w)) throw new Error(`not in wordsCore: ${w}`);
  }

  const pairs = [
    ...themeBlue.map((w) => ({ w, role: "blue" })),
    ...fillerBlue.map((w) => ({ w, role: "blue" })),
    ...red.map((w) => ({ w, role: "red" })),
    ...neutral.map((w) => ({ w, role: "neutral" })),
    { w: assassin, role: "assassin" },
  ];
  const shuffled = shufflePairs(pairs, seed);
  const words = shuffled.map((p) => p.w);
  const assignment = shuffled.map((p) => p.role);
  const targetIndices = themeBlue.map((tw) => {
    const ix = words.indexOf(tw);
    if (ix < 0) throw new Error(`missing theme word ${tw}`);
    return ix;
  });
  return {
    words,
    assignment,
    firstClue: { clue, number, targetIndices },
  };
}

const specs = [
  {
    clue: "OCEAN",
    number: 3,
    themeBlue: ["FISH", "BEACH", "WAVE"],
    fillerBlue: ["TABLE", "MUG", "NURSE", "CLOAK", "BELL", "HAWK"],
    red: ["WATER", "POOL", "PORT", "SHIP", "SUB", "WHALE", "GRASS", "ROCK"],
    neutral: ["KING", "QUEEN", "CROWN", "KNIGHT", "PLANE", "CAR", "BRIDGE"],
    assassin: "POISON",
    seed: 0x4f434541,
  },
  {
    clue: "SOUND",
    number: 4,
    themeBlue: ["BAND", "PITCH", "NOTE", "JAM"],
    fillerBlue: ["CLOUD", "WHEEL", "PUPIL", "CRANE", "MAMMOTH"],
    red: ["DOCTOR", "NURSE", "HOSPITAL", "DISEASE", "CHEST", "HEART", "HEAD", "FACE"],
    neutral: ["TABLE", "CHAIR", "BED", "KEY", "LOCK", "ROCK", "ARM"],
    assassin: "POISON",
    seed: 0x534f554e,
  },
  {
    clue: "NATION",
    number: 3,
    themeBlue: ["FRANCE", "GERMANY", "GREECE"],
    fillerBlue: ["TABLE", "MUG", "CLOUD", "DRILL", "JACK", "KIWI"],
    red: ["ENGLAND", "AMERICA", "CANADA", "MEXICO", "CHINA", "INDIA", "EGYPT", "ROME"],
    neutral: ["LONDON", "BEIJING", "TOKYO", "MOSCOW", "MAPLE", "ICE", "GLASS"],
    assassin: "DEATH",
    seed: 0x4e415449,
  },
  {
    clue: "SWEET",
    number: 4,
    themeBlue: ["APPLE", "ORANGE", "HONEY", "JAM"],
    fillerBlue: ["BUTTON", "CLOUD", "DRILL", "FENCE", "GLOVE"],
    red: ["BERRY", "CHOCOLATE", "COOK", "LEMON", "PIE", "HAM", "PLATE", "FORK"],
    neutral: ["KNIFE", "GLASS", "MUG", "BOTTLE", "PAN", "CARROT", "FIRE"],
    assassin: "POISON",
    seed: 0x53574545,
  },
  {
    clue: "PET",
    number: 3,
    themeBlue: ["BEAR", "DOG", "HORSE"],
    fillerBlue: ["TABLE", "PIANO", "CLOUD", "BELL", "NURSE", "MUG"],
    red: ["WHALE", "SHARK", "EAGLE", "WORM", "SPIDER", "BUG", "FLY", "BAT"],
    neutral: ["RABBIT", "CAT", "MOUSE", "DUCK", "KANGAROO", "LION", "PENGUIN"],
    assassin: "DEATH",
    seed: 0x50455421,
  },
  {
    clue: "METAL",
    number: 2,
    themeBlue: ["IRON", "COPPER"],
    fillerBlue: ["GOLD", "NAIL", "BOLT", "TABLE", "MUG", "CLOAK", "BELL"],
    red: ["DIAMOND", "IVORY", "LEAD", "PAPER", "GLASS", "PLASTIC", "COTTON", "DROP"],
    neutral: ["WIND", "SNOW", "ICE", "FIRE", "LASER", "TORCH", "MATCH"],
    assassin: "BOMB",
    seed: 0x4d455441,
  },
  {
    clue: "FREEZE",
    number: 2,
    themeBlue: ["ICE", "SNOW"],
    fillerBlue: ["COLD", "ICICLE", "TABLE", "MUG", "NURSE", "BELL", "HAWK"],
    red: ["WIND", "WATER", "WAVE", "STREAM", "FIRE", "LIGHT", "LASER", "TORCH"],
    neutral: ["DRAGON", "PHOENIX", "STAR", "MATCH", "TICK", "CHAIR", "BED"],
    assassin: "DEATH",
    seed: 0x46524545,
  },
  {
    clue: "ROYAL",
    number: 3,
    themeBlue: ["KING", "QUEEN", "CROWN"],
    fillerBlue: ["KNIGHT", "PRINCESS", "RULER", "TABLE", "MUG", "CLOUD"],
    red: ["GOLD", "IVORY", "RING", "SOLDIER", "PISTOL", "MISSILE", "BOMB", "WAR"],
    neutral: ["SHIP", "PLANE", "TRAIN", "JET", "FIELD", "GRASS", "MOUNT"],
    assassin: "POISON",
    seed: 0x524f594c,
  },
  {
    clue: "ORBIT",
    number: 4,
    themeBlue: ["MOON", "STAR", "SATURN", "JUPITER"],
    fillerBlue: ["TABLE", "MUG", "NURSE", "BELL", "HAWK"],
    red: ["MERCURY", "ALIEN", "TELESCOPE", "SATELLITE", "LASER", "TRAIN", "CAR", "SHIP"],
    neutral: ["PLANE", "HELICOPTER", "PILOT", "ENGINE", "JET", "SUB", "HOTEL"],
    assassin: "DEATH",
    seed: 0x4f524249,
  },
  {
    clue: "SHARP",
    number: 2,
    themeBlue: ["KNIFE", "NEEDLE"],
    fillerBlue: ["PIN", "SPIKE", "FILE", "DRILL", "TABLE", "MUG", "NURSE"],
    red: ["NAIL", "BOLT", "NUT", "STICK", "STRING", "NET", "WEB", "LINK"],
    neutral: ["PLATE", "GLASS", "PAPER", "BOARD", "BOX", "BLOCK", "BUTTON"],
    assassin: "BOMB",
    seed: 0x53484152,
  },
];

const out = specs.map((s) => buildPuzzle(s));
const dest = path.join(__dirname, "..", "data", "codenames-curated-puzzles.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log("Wrote", dest);
