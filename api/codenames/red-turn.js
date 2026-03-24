require("../../lib/loadEnv")();
const { verifyToken, parseRevealed } = require("../../lib/state");
const { runRedTurnLocal, teamWordsLeft } = require("../../lib/codenamesRedSim");

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

  const game = verifyToken(body.token);
  if (!game) {
    res.status(400).json({ error: "Invalid game token" });
    return;
  }
  const { words, assignment } = game;
  const revealed = parseRevealed(body.revealed || {});
  if (!verifyRevealedMap(assignment, revealed)) {
    res.status(400).json({ error: "Revealed state does not match game" });
    return;
  }

  if (teamWordsLeft(assignment, revealed, "red") === 0) {
    res.status(200).json({
      clue: "PASS",
      number: 0,
      steps: [],
      revealed,
      gameOver: false,
      winner: null,
      redSimulated: true,
    });
    return;
  }

  const out = runRedTurnLocal(words, assignment, revealed);
  res.status(200).json(out);
};
