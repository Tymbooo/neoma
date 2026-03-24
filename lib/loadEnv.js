/**
 * Vercel `vercel dev` does not always expose `.env.local` to Node serverless
 * handlers. Load it once from the repo root when the file exists.
 * Use `GEMINI_API_KEY`, `XAI_API_KEY`, etc. in `.env.local` (see `.gitignore`).
 */
const fs = require("fs");
const path = require("path");

let attempted = false;

module.exports = function loadEnv() {
  if (attempted) return;
  attempted = true;
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(__dirname, "..", ".env.local"),
  ];
  for (const envLocal of candidates) {
    if (fs.existsSync(envLocal)) {
      require("dotenv").config({ path: envLocal });
      return;
    }
  }
};
