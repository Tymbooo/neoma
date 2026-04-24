require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const { outcomeAfterReveal, fullRevealPayload } = require("../../lib/codenamesRedSim");

function verifyRevealedMap(assignment, revealed) {
  for (const [k, r] of Object.entries(revealed)) {
    const i = parseInt(k, 10);
    if (i < 0 || i > 24) return false;
    if (assignment[i] !== r) return false;
  }
  return true;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const { token, index, revealed: revealedRaw, byTeam } = body;
  const game = verifyToken(token);
  if (!game) {
    res.status(400).json({ error: "Invalid game token" });
    return;
  }
  const { words, assignment } = game;
  const idx = parseInt(index, 10);
  if (idx < 0 || idx > 24) {
    res.status(400).json({ error: "Bad index" });
    return;
  }
  const revealed = parseRevealed(revealedRaw || {});
  if (!verifyRevealedMap(assignment, revealed)) {
    res.status(400).json({ error: "Revealed state does not match game" });
    return;
  }
  if (revealed[idx]) {
    res.status(400).json({ error: "Already revealed" });
    return;
  }
  const guesser = byTeam === "red" ? "red" : "blue";
  const role = assignment[idx];
  const nextRevealed = { ...revealed, [idx]: role };

  let gameOver = false;
  let winner = null;
  let winReason = null;

  if (role === "assassin") {
    const o = outcomeAfterReveal(assignment, nextRevealed, { assassinRevealedBy: guesser });
    gameOver = o.gameOver;
    winner = o.winner;
    winReason = o.winReason;
  } else {
    const o = outcomeAfterReveal(assignment, nextRevealed);
    gameOver = o.gameOver;
    winner = o.winner;
    winReason = o.winReason;
  }

  res.status(200).json({
    index: idx,
    role,
    word: words[idx],
    gameOver,
    winner,
    winReason,
    revealed: nextRevealed,
    fullReveal: gameOver ? fullRevealPayload(assignment) : undefined,
  });
};
