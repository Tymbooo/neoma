const crypto = require("crypto");
const WORDS = require("./words");

function hmacSecret() {
  return (
    process.env.CODENAMES_HMAC_SECRET ||
    process.env.GEMINI_API_KEY ||
    "dev-only-change-in-production"
  );
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWords() {
  const pool = shuffle([...WORDS]);
  return pool.slice(0, 25);
}

/** @returns {('blue'|'red'|'neutral'|'assassin')[]} */
function randomAssignment() {
  const shuffled = shuffle([...Array(25).keys()]);
  const a = Array(25);
  for (let i = 0; i < 9; i++) a[shuffled[i]] = "blue";
  for (let i = 0; i < 8; i++) a[shuffled[9 + i]] = "red";
  for (let i = 0; i < 7; i++) a[shuffled[17 + i]] = "neutral";
  a[shuffled[24]] = "assassin";
  return a;
}

function sign(words, assignment) {
  const body = JSON.stringify({ w: words, a: assignment });
  const sig = crypto.createHmac("sha256", hmacSecret()).update(body).digest("hex");
  return Buffer.from(JSON.stringify({ w: words, a: assignment, s: sig })).toString(
    "base64url"
  );
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const o = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const { w, a, s } = o;
    if (!Array.isArray(w) || w.length !== 25 || !Array.isArray(a) || a.length !== 25)
      return null;
    const body = JSON.stringify({ w, a });
    const sig = crypto.createHmac("sha256", hmacSecret()).update(body).digest("hex");
    if (sig !== s) return null;
    return { words: w, assignment: a };
  } catch {
    return null;
  }
}

/** @param {Record<string,string>} revealed map index string -> role */
function parseRevealed(revealed) {
  const out = {};
  if (!revealed || typeof revealed !== "object") return out;
  for (const [k, v] of Object.entries(revealed)) {
    const i = parseInt(k, 10);
    if (i >= 0 && i < 25 && ["blue", "red", "neutral", "assassin"].includes(v)) {
      out[i] = v;
    }
  }
  return out;
}

module.exports = {
  pickWords,
  randomAssignment,
  sign,
  verifyToken,
  parseRevealed,
};
