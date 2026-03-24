require("../lib/loadEnv")();
const { createSignedGame, BOT_NAMES } = require("../lib/imposterState");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { token, word, imposterSeat, order } = createSignedGame();

    res.status(200).json({
      token,
      botNames: BOT_NAMES,
      order,
      youAreImposter: imposterSeat === 0,
      secretWord: imposterSeat === 0 ? null : word,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
};
