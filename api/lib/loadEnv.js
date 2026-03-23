/**
 * Vercel `vercel dev` does not always expose `.env.local` to Node serverless
 * handlers. Load it explicitly from the repo root when the key is missing.
 */
const fs = require("fs");
const path = require("path");

module.exports = function loadEnv() {
  if (process.env.GEMINI_API_KEY) return;
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(__dirname, "..", "..", ".env.local"),
  ];
  for (const envLocal of candidates) {
    if (fs.existsSync(envLocal)) {
      require("dotenv").config({ path: envLocal });
      return;
    }
  }
};
