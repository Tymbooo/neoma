require("../../lib/loadEnv")();
const { pickWords, randomAssignment, sign } = require("../../lib/state");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const words = pickWords();
    const assignment = randomAssignment();
    const token = sign(words, assignment);
    res.status(200).json({ token, words });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
};
