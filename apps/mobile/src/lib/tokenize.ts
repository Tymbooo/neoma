/**
 * Keep frontend tokenization aligned with backend gloss validation:
 * punctuation can stick to tokens (e.g. "despliegue.").
 */
export function lineTokens(line: string): string[] {
  return String(line || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
