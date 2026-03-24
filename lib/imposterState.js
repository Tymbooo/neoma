const crypto = require("crypto");

/** Common nouns suitable for the Imposter party game (single word, no spaces). */
const IMPOSTER_WORDS = [
  "beach", "castle", "kitchen", "dragon", "violin", "thunder", "crystal", "pirate",
  "galaxy", "forest", "desert", "volcano", "tornado", "rainbow", "diamond", "pyramid",
  "robot", "wizard", "circus", "museum", "airport", "hospital", "library", "theater",
  "carnival", "safari", "harbor", "temple", "palace", "bazaar", "lighthouse", "waterfall",
  "avalanche", "meteor", "eclipse", "compass", "telescope", "microscope", "satellite",
  "submarine", "helicopter", "tractor", "canyon", "glacier", "oasis", "jungle", "savanna",
  "orchard", "vineyard", "bakery", "brewery", "factory", "laboratory", "observatory",
  "aquarium", "planetarium", "stadium", "cathedral", "monastery", "fortress", "dungeon",
  "treasure", "phoenix", "griffin", "unicorn", "octopus", "penguin", "dolphin", "eagle",
  "tiger", "panda", "koala", "cactus", "bamboo", "lotus", "orchid", "marble", "granite",
  "ember", "blizzard", "monsoon", "horizon", "nebula", "quasar", "asteroid", "comet",
];

function hmacSecret() {
  return (
    process.env.CODENAMES_HMAC_SECRET ||
    process.env.GEMINI_API_KEY ||
    "dev-only-change-in-production"
  );
}

function aesKey() {
  return crypto.createHash("sha256").update(hmacSecret()).digest();
}

function encryptWord(word) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const enc = Buffer.concat([cipher.update(word, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    w: enc.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

function decryptWord(parts) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    aesKey(),
    Buffer.from(parts.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(parts.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.w, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickSecretWord() {
  const pool = shuffle([...IMPOSTER_WORDS]);
  return pool[0];
}

/** Deterministic JSON for HMAC (key order stable). */
function gameFieldsStringForSig(p) {
  return JSON.stringify({
    imposterSeat: p.imposterSeat,
    iv: p.iv,
    order: p.order,
    tag: p.tag,
    v: p.v,
    w: p.w,
  });
}

function createSignedGame() {
  const word = pickSecretWord();
  const imposterSeat = Math.floor(Math.random() * 4);
  const order = shuffle([0, 1, 2, 3]);
  const { w, iv, tag } = encryptWord(word);
  const pack = { imposterSeat, order, w, iv, tag, v: 2 };
  const token = signGame(pack);
  return { token, word, imposterSeat, order };
}

function signGame(payload) {
  const { s: _drop, ...rest } = payload;
  const sig = crypto
    .createHmac("sha256", hmacSecret())
    .update(gameFieldsStringForSig(rest))
    .digest("hex");
  return Buffer.from(JSON.stringify({ ...rest, s: sig })).toString("base64url");
}

function verifyGame(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const o = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const { imposterSeat, order, w, iv, tag, v, s } = o;
    if (v !== 2) return null;
    if (!Number.isInteger(imposterSeat) || imposterSeat < 0 || imposterSeat > 3) return null;
    if (!Array.isArray(order) || order.length !== 4) return null;
    const set = new Set(order);
    if (set.size !== 4 || ![0, 1, 2, 3].every((x) => set.has(x))) return null;
    if (typeof w !== "string" || typeof iv !== "string" || typeof tag !== "string") return null;

    const { s: sigStored, ...rest } = o;
    const sig = crypto
      .createHmac("sha256", hmacSecret())
      .update(gameFieldsStringForSig(rest))
      .digest("hex");
    if (sig !== sigStored) return null;

    const word = decryptWord({ w, iv, tag }).toLowerCase();
    if (!word || !/^[a-z]+$/.test(word)) return null;
    return { word, imposterSeat, order };
  } catch {
    return null;
  }
}

const BOT_NAMES = ["You", "Avery", "Blake", "Casey"];

module.exports = {
  IMPOSTER_WORDS,
  createSignedGame,
  signGame,
  verifyGame,
  BOT_NAMES,
};
