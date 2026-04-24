require("../../lib/loadEnv")();
const { sign, buildOperativeHumanBoard } = require("../../lib/state");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let includeKey = false;
    /** @type {string | null} */
    let humanRole = null;
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        if (body && body.humanRole === "spymaster") includeKey = true;
        if (body && typeof body.humanRole === "string") humanRole = body.humanRole;
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    const built = buildOperativeHumanBoard();
    const { words, assignment, presetClues } = built;
    const token =
      humanRole === "operative"
        ? sign(words, assignment, { presetClues })
        : sign(words, assignment, {});
    const out = { token, words };
    if (includeKey) {
      out.assignment = assignment;
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
};
