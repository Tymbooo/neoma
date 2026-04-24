const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_CLUE = {
  type: SchemaType.OBJECT,
  properties: {
    clue: { type: SchemaType.STRING },
    number: { type: SchemaType.INTEGER },
    targetIndices: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
    },
  },
  required: ["clue", "number", "targetIndices"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_CLUE_DOMINANCE = {
  type: SchemaType.OBJECT,
  properties: {
    ok: { type: SchemaType.BOOLEAN },
  },
  required: ["ok"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_GUESSES = {
  type: SchemaType.OBJECT,
  properties: {
    guesses: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
    },
  },
  required: ["guesses"],
};

/** JSON schema with exact array length (helps Gemini return a full guess plan). */
function buildSchemaCodenamesGuessesExact(exactLen) {
  const n = Math.max(0, Math.min(25, Math.floor(exactLen)));
  return {
    type: SchemaType.OBJECT,
    properties: {
      guesses: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.INTEGER },
        minItems: n,
        maxItems: n,
      },
    },
    required: ["guesses"],
  };
}

/** One score per unrevealed cell: index + 0–100 relation to clue. */
function buildSchemaCodenamesOperativeScoresExact(exactLen) {
  const n = Math.max(0, Math.min(25, Math.floor(exactLen)));
  return {
    type: SchemaType.OBJECT,
    properties: {
      scores: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            index: { type: SchemaType.INTEGER },
            score: { type: SchemaType.INTEGER },
          },
          required: ["index", "score"],
        },
        minItems: n,
        maxItems: n,
      },
    },
    required: ["scores"],
  };
}

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_CLUE = {
  type: SchemaType.OBJECT,
  properties: {
    word: { type: SchemaType.STRING },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["word", "reasoning"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_VOTE = {
  type: SchemaType.OBJECT,
  properties: {
    vote: { type: SchemaType.INTEGER },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["vote", "reasoning"],
};

/** One model call for seats 1–3 (avoids triple latency / Vercel hobby timeouts). */
/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_VOTES_BATCH = {
  type: SchemaType.OBJECT,
  properties: {
    votes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          seat: { type: SchemaType.INTEGER },
          vote: { type: SchemaType.INTEGER },
          reasoning: { type: SchemaType.STRING },
        },
        required: ["seat", "vote", "reasoning"],
      },
    },
  },
  required: ["votes"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_REDEEM = {
  type: SchemaType.OBJECT,
  properties: {
    word: { type: SchemaType.STRING },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["word", "reasoning"],
};

/**
 * @param {import("@google/generative-ai").ResponseSchema} [responseSchema]
 * @param {{ temperature?: number, maxOutputTokens?: number }} [options]
 */
function getModel(responseSchema, options = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(key);
  const name =
    process.env.GEMINI_MODEL || "gemini-2.5-flash";
  /** @type {import("@google/generative-ai").GenerationConfig} */
  const generationConfig = {
    temperature: options.temperature ?? 0.4,
    maxOutputTokens: options.maxOutputTokens ?? 2048,
    responseMimeType: "application/json",
  };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }
  return genAI.getGenerativeModel({
    model: name,
    generationConfig,
  });
}

/** Remove optional ```json fences only (do not slice `{`…`}` — that breaks strings containing `}`). */
function stripMarkdownFences(text) {
  let t = String(text || "").replace(/^\uFEFF/, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * First balanced `{...}` or `[...]` slice, respecting JSON string rules (so `}` inside "reasoning" is OK).
 * @param {string} s
 */
function extractBalancedJsonSlice(s) {
  const t = String(s || "");
  const objStart = t.indexOf("{");
  const arrStart = t.indexOf("[");
  let start = -1;
  if (objStart < 0 && arrStart < 0) return null;
  if (arrStart < 0 || (objStart >= 0 && objStart < arrStart)) start = objStart;
  else start = arrStart;

  const stack = [];
  let inStr = false;
  let esc = false;

  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      stack.push("}");
      continue;
    }
    if (c === "[") {
      stack.push("]");
      continue;
    }
    if (c === "}" || c === "]") {
      if (!stack.length || stack[stack.length - 1] !== c) return null;
      stack.pop();
      if (stack.length === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Decode a JSON string slice captured from model output (fallback path). */
function decodeJsonStringSlice(s) {
  if (!s) return "";
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Last-resort extraction when the model returns prose or broken JSON.
 * @param {string} text
 */
function parseJsonFallback(text) {
  const t = String(text || "");

  const clueMatch = t.match(
    /\{[^{}]*"clue"\s*:\s*"[^"]*"\s*,\s*"number"\s*:\s*\d+\s*\}/
  );
  if (clueMatch) return JSON.parse(clueMatch[0]);

  const guessMatch = t.match(/\{[^{}]*"guesses"\s*:\s*\[[^\]]*\]\s*\}/);
  if (guessMatch) return JSON.parse(guessMatch[0]);

  // Imposter bot clue (tolerate any non-quote chars inside "word")
  const wordMatch = t.match(/"word"\s*:\s*"([^"]+)"/);
  if (wordMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      word: String(wordMatch[1] || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, ""),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  // Imposter vote: number or string digit
  let voteMatch = t.match(/"vote"\s*:\s*([0-3])\b/);
  if (!voteMatch) voteMatch = t.match(/"vote"\s*:\s*"([0-3])"/);
  if (voteMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      vote: parseInt(voteMatch[1], 10),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  return null;
}

/**
 * @param {string} prompt
 * @param {import("@google/generative-ai").ResponseSchema} [responseSchema]
 * @param {{ temperature?: number, maxOutputTokens?: number }} [modelOptions]
 */
async function generateJsonPrompt(prompt, responseSchema, modelOptions) {
  const model = getModel(responseSchema, modelOptions || {});
  const result = await model.generateContent(prompt);
  const response = result.response;
  const cands = response.candidates;
  if (!cands || cands.length === 0) {
    const br = response.promptFeedback?.blockReason;
    throw new Error(
      br ? `Model blocked (${br})` : "Empty model response (no candidates)"
    );
  }
  let text;
  try {
    text = response.text();
  } catch (e) {
    throw new Error(e.message || "No text in model response");
  }
  if (!String(text).trim()) {
    throw new Error("Empty model response text");
  }

  const cleaned = stripMarkdownFences(text);
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const slice = extractBalancedJsonSlice(cleaned);
    if (slice) {
      try {
        parsed = JSON.parse(slice);
      } catch {
        parsed = null;
      }
    }
  }
  if (parsed !== null && typeof parsed === "object") {
    return parsed;
  }
  const fallback = parseJsonFallback(text);
  if (fallback) return fallback;
  throw new Error("Could not parse model JSON");
}

/**
 * @param {'blue'|'red'} team
 * @param {string[]} words 25
 * @param {string[]} assignment
 * @param {Record<number,string>} revealed
 */
function buildSpymasterPrompt(team, words, assignment, revealed) {
  const teamWords = [];
  const red = [];
  const blue = [];
  const neutral = [];
  let assassin = -1;
  for (let i = 0; i < 25; i++) {
    const role = assignment[i];
    if (role === "blue") blue.push(i);
    else if (role === "red") red.push(i);
    else if (role === "neutral") neutral.push(i);
    else if (role === "assassin") assassin = i;
  }
  if (team === "blue") teamWords.push(...blue);
  else teamWords.push(...red);

  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (already revealed as ${st})`;
    return `${i}: ${w}`;
  });

  const teamLabel = team === "blue" ? "BLUE" : "RED";
  const oppLabel = team === "blue" ? "RED" : "BLUE";
  const teamEs = team === "blue" ? "AZUL" : "ROJO";
  const oppEs = team === "blue" ? "ROJO" : "AZUL";
  const unrevealedTeamIdx = teamWords.filter((i) => !revealed[i]);
  const unrevealedTeamStr = unrevealedTeamIdx.join(", ") || "(ninguna — pasar)";
  const preferLargeN =
    unrevealedTeamIdx.length >= 4
      ? `
Preferencia de número: si quedan al menos cuatro palabras ${teamEs} sin revelar, prefiera N=3 o N=4 cuando la colisión y la dominancia lo permitan; use N=1 o N=2 solo si no hay un conjunto mayor seguro.
`
      : "";
  return `Eres el espía maestro del equipo ${teamEs} en Codenames (juego de asociación de palabras).
Las palabras del tablero están en ESPAÑOL (una sola palabra por casilla, en mayúsculas).

Tablero (índice: palabra). Las palabras no reveladas no tienen paréntesis.
${lines.join("\n")}

Mapa secreto (no menciones los colores al operativo en lenguaje natural — solo JSON):
- Fichas AZULES (índices): ${blue.join(", ")}
- Fichas ROJAS (índices): ${red.join(", ")}
- NEUTRALES (índices): ${neutral.join(", ")}
- ASESINO (índice): ${assassin}

Tu equipo es ${teamEs}. Aún deben adivinar estas palabras ${teamEs} no reveladas: ${unrevealedTeamStr}.${preferLargeN}
Disciplina de colisiones (crítico):
- Para cada pista: ¿un jugador fuerte podría adivinar con la misma facilidad alguna palabra ${oppEs} o NEUTRAL no revelada? Si sí, elige otra pista.
- Evita pistas de dominio demasiado amplias que inviten a muchos aciertos en el tablero, salvo que esas casillas sean ${teamEs} o ya estén reveladas.
- Tu número N debe contar solo palabras ${teamEs} que pretendas enlazar.

Regla de dominancia (mín–máx, frente a no-${teamEs} no reveladas: rival, neutrales, asesino):
- Entre tus N objetivos, toma la asociación MÁS DÉBIL con la pista (T_min). Entre todas las palabras no-${teamEs} no reveladas, toma la asociación MÁS FUERTE (D_max). Necesitas T_min ESTRICTAMENTE mayor que D_max. Las palabras ${teamEs} no reveladas que no están en targetIndices se ignoran.

Reglas de tu pista:
- Responde SOLO con JSON válido, sin markdown: {"clue":"UNASOLAPALABRA","number":N,"targetIndices":[i1,i2,...]}
- "targetIndices" debe listar exactamente N índices distintos (0–24) que sean fichas ${teamEs} no reveladas. Para {"clue":"PASS","number":0} usa "targetIndices":[].
- "clue" debe ser UNA sola palabra en ESPAÑOL, en MAYÚSCULAS, sin trampas de homónimos.
- No puede ser idéntica a ninguna palabra del tablero (revelada o no), ni subcadena de ninguna palabra del tablero.
- "number" N es cuántas palabras de TU equipo enlaza la pista (mínimo 1 si quedan palabras).
- Si no quedan palabras para tu equipo, usa {"clue":"PASS","number":0,"targetIndices":[]}

Solo JSON.`;
}

/**
 * Second-pass check: weakest target vs strongest danger (unrevealed non-team only).
 * (Unrevealed same-team words that are not targets are ignored.)
 * @param {string[]} words
 * @param {string[]} assignment
 * @param {'blue'|'red'} team
 * @param {Record<number,string>} revealed
 * @param {string} clueUpper
 * @param {number[]} targetIndices
 * @param {string} teamLabel BLUE or RED
 */
function buildClueDominanceVerifyPrompt(
  words,
  assignment,
  team,
  revealed,
  clueUpper,
  targetIndices,
  teamLabel
) {
  const tset = new Set(targetIndices);
  const targetWords = targetIndices.map((i) => words[i]).join(", ");
  const others = [];
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (tset.has(i)) continue;
    if (assignment[i] === team) continue;
    others.push(words[i]);
  }
  if (others.length === 0) {
    return `Comprobación de dominancia (Codenames). Solo JSON.

Pista: "${clueUpper}"
Palabras ${teamLabel} pretendidas: ${targetWords}
No quedan cartas rivales, neutrales ni asesino sin revelar. Responde {"ok":true}.`;
  }
  return `Comprobación de dominancia de pista (Codenames). Solo JSON.

Pista dada a los operativos: "${clueUpper}"
Palabras ${teamLabel} pretendidas: ${targetWords}

Palabras NO-${teamLabel} no reveladas (rival, neutrales, asesino): ${others.join(", ")}

Regla mín–máx: entre las palabras pretendidas, ¿cuál tiene el vínculo MÁS DÉBIL con la pista? En la segunda lista, ¿cuál tiene el vínculo MÁS FUERTE? Responde {"ok":true} solo si el vínculo más débil pretendido sigue siendo ESTRICTAMENTE más fuerte que el mayor peligro. Si empatan o gana el peligro, {"ok":false}.

Solo JSON.`;
}

/**
 * @param {'red'} team — operative
 */
function buildOperativePrompt(team, words, revealed, clueWord, clueNumber, redIndices) {
  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (revealed)`;
    return `${i}: ${w}`;
  });

  const unrevealedRed = redIndices.filter((i) => !revealed[i]);
  const maxGuesses = clueNumber <= 0 ? 0 : clueNumber;

  return `Eres el operativo ROJO en Codenames. Las palabras del tablero están en español.

Tablero:
${lines.join("\n")}

La pista de tu espía maestro es: "${clueWord}" ${clueNumber}.
Puedes hacer como máximo ${maxGuesses} intento(s) este turno.

Tu meta es elegir índices de palabras que probablemente sean del equipo ROJO. No sabes cuáles son rojas; infiere desde la pista.

Responde SOLO con JSON: {"guesses":[i1,i2,...]} con índices 0–24, solo casillas NO reveladas, sin duplicados, como máximo ${maxGuesses}. Puedes acertar menos si dudas. El orden es el orden de tus toques.

Solo JSON.`;
}

/**
 * Blue operative (for human spymaster + AI operative).
 * @param {string[]} words
 * @param {Record<number,string>} revealed
 * @param {string} clueWord
 * @param {number} clueNumber
 * @param {{ requiredGuessCount?: number, correctionNote?: string }} [opts]
 */
function buildBlueOperativePrompt(words, revealed, clueWord, clueNumber, opts = {}) {
  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (revealed)`;
    return `${i}: ${w}`;
  });

  const allowance = clueNumber <= 0 ? 0 : clueNumber;
  const unrevealed = words.reduce((acc, _, i) => acc + (revealed[i] ? 0 : 1), 0);
  const requiredGuessCount =
    typeof opts.requiredGuessCount === "number"
      ? opts.requiredGuessCount
      : Math.min(allowance, unrevealed);

  const correction = opts.correctionNote
    ? `\n\n${opts.correctionNote}\n`
    : "";

  return `Eres el operativo AZUL en Codenames. Las palabras del tablero están en español.

Tablero:
${lines.join("\n")}

La pista de tu espía maestro es: "${clueWord}" ${clueNumber}.
El número de la pista es tu máximo de intentos este turno: **${allowance}**, limitado por las casillas tapadas que queden.

Debes planear una **lista ordenada completa** de exactamente **${requiredGuessCount}** índices distintos (solo casillas no reveladas). El juego puede parar antes si fallas color o el asesino, pero igual devuelves **${requiredGuessCount}** intentos en el orden en que tocarías.${correction}

Tu meta: índices que probablemente sean AZULES. No sabes cuáles son azules; infiere desde la pista.

Responde SOLO con JSON: {"guesses":[...]} — el array debe tener **exactamente ${requiredGuessCount}** enteros, 0–24, solo NO reveladas, sin duplicados.

Solo JSON.`;
}

/**
 * Blue operative scores every unrevealed card vs clue; play order is sort by score desc.
 * @param {string[]} words
 * @param {Record<number,string>} revealed
 * @param {string} clueWord
 * @param {number} clueNumber
 * @param {number[]} unrevealedIndices
 * @param {{ correctionNote?: string }} [opts]
 */
function buildBlueOperativeScorePrompt(words, revealed, clueWord, clueNumber, unrevealedIndices, opts = {}) {
  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (already revealed — do not score)`;
    return `${i}: ${w}`;
  });

  const k = unrevealedIndices.length;
  const toScoreLines = unrevealedIndices
    .slice()
    .sort((a, b) => a - b)
    .map((i) => `${i}: ${words[i]}`)
    .join("\n");

  const correction = opts.correctionNote ? `\n\n${opts.correctionNote}\n` : "";

  return `Eres el operativo AZUL en Codenames. Las palabras del tablero están en español.

Tablero completo (contexto):
${lines.join("\n")}

La pista del espía maestro es: **"${clueWord}"** con número **${clueNumber}** (máximo de volteos si ordenas del mejor al peor).

**Tarea:** Para cada palabra NO REVELADA de la lista, devuelve un **puntaje entero de 0 a 100** según qué tan fuerte se relaciona con la pista **"${clueWord}"** (sentido, asociación, lógica típica de Codenames). No sabes qué fichas son azules, rojas, neutrales o el asesino.

Guía:
- **100** = vínculo muy fuerte y directo
- **50** = vínculo plausible o parcial
- **0** = sin relación, engañoso u opuesto

Debes puntuar **cada** celda de la lista exactamente una vez (${k} entradas):
${toScoreLines}

Responde SOLO con JSON: {"scores":[{"index":i,"score":s},...]}
Reglas: "scores" debe tener **exactamente ${k}** objetos; cada "index" de la lista, sin duplicados; cada "score" entero 0–100.${correction}

Solo JSON.`;
}

module.exports = {
  generateJsonPrompt,
  buildSpymasterPrompt,
  buildClueDominanceVerifyPrompt,
  buildOperativePrompt,
  buildBlueOperativePrompt,
  buildBlueOperativeScorePrompt,
  buildSchemaCodenamesGuessesExact,
  buildSchemaCodenamesOperativeScoresExact,
  SCHEMA_CODENAMES_CLUE,
  SCHEMA_CODENAMES_CLUE_DOMINANCE,
  SCHEMA_CODENAMES_GUESSES,
  SCHEMA_IMPOSTER_CLUE,
  SCHEMA_IMPOSTER_VOTE,
  SCHEMA_IMPOSTER_VOTES_BATCH,
  SCHEMA_IMPOSTER_REDEEM,
};
