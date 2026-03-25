const { BOT_NAMES } = require("./imposterState");

/** Random sample in JSON example so the model never copies a fixed YOURWORD placeholder. */
const BOT_CLUE_EXAMPLE_WORDS = [
  "NATURE",
  "BIG",
  "SMALL",
  "TIME",
  "PLACE",
  "LIGHT",
  "DARK",
  "SOUND",
  "MOVE",
  "STILL",
  "OPEN",
  "CLOSE",
  "HIGH",
  "LOW",
  "ROUND",
  "SHARP",
  "SOFT",
  "HARD",
  "FAST",
  "SLOW",
];

/** Words that must never be accepted as a clue (prompt-template garbage). */
const BOT_CLUE_ARTIFACT_WORDS = new Set([
  "YOURWORD",
  "PLACEHOLDER",
  "EXAMPLE",
  "TEMPLATE",
  "SINGLEWORD",
  "JSONONLY",
  "UNKNOWN",
  "RESPONSE",
  "FORMAT",
  "MARKDOWN",
]);

function pickBotClueExampleWord() {
  const i = Math.floor(Math.random() * BOT_CLUE_EXAMPLE_WORDS.length);
  return BOT_CLUE_EXAMPLE_WORDS[i];
}

function isBotClueArtifactWord(wordUpper) {
  if (!wordUpper) return false;
  return BOT_CLUE_ARTIFACT_WORDS.has(wordUpper);
}

/**
 * @param {object} o
 * @param {string} o.secretWord
 * @param {number} o.imposterSeat
 * @param {number[]} o.order
 * @param {number} o.botSeat 1-3
 * @param {number} o.round 1 or 2
 * @param {{seat:number,word:string,round:number}[]} o.clues
 */
function buildBotCluePrompt(o) {
  const { secretWord, imposterSeat, order, botSeat, round, clues } = o;
  const innocent = botSeat !== imposterSeat;
  const name = BOT_NAMES[botSeat];
  const exampleWord = pickBotClueExampleWord();
  const noCluesYet = clues.length === 0;

  const clueLines = clues.length
    ? clues.map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`).join("\n")
    : "(no clues yet)";

  const orderLine = order.map((s) => BOT_NAMES[s]).join(" → ");

  const roleBlock = innocent
    ? `You ARE an Innocent. You know the secret word is "${secretWord}".`
    : `You ARE the Imposter. You do NOT know the secret word.`;

  const innocentDiscipline = innocent
    ? `
INNOCENT CLUE DISCIPLINE (critical — the Imposter hears every clue):
- Prefer INDIRECT links only: metaphor, a part or component, setting/atmosphere, or vibe — not the “headline” association most players would blurt first.
- Before choosing, mentally list the FIVE most obvious single-word clues tied to this secret; you must NOT use any of them, nor obvious inflections of them, nor words that share the same dominant stem/root as the secret when that would sharply narrow the answer.
- Avoid category-label clues that name the kind of thing the secret is when that would let someone pin the exact codeword (e.g. for a wildlife-trip–type concept, words like AFRICA, JEEP, BINOCULARS, WILD, ZOO are usually too narrowing unless you mean a clearly remote sense — prefer an oblique angle).
- After your clue, a smart Imposter should still be unsure among several plausible secret words in a broad band — not confident of the one true word.
`
    : "";

  const firstInnocentOpening =
    innocent && noCluesYet
      ? `
FIRST CLUE THIS ROUND: No one has spoken yet in this round. You still must follow INNOCENT CLUE DISCIPLINE — start broad and indirect so the Imposter cannot lock onto the secret.
`
    : "";

  const firstImposterOpening =
    !innocent && noCluesYet
      ? `
YOU SPEAK FIRST THIS ROUND (no clues yet): There is no thread to match. Output ONE vague, ordinary English word (like SIZE, TIME, FEEL, or similar breadth) that could plausibly fit many secret words across different themes — not meta-commentary, not refusing the turn, not "waiting" for others. You ARE ${name}; it IS your turn now.
`
    : "";

  const imposterBlend = innocent
    ? ""
    : noCluesYet
      ? ""
      : `
IMPOSTER BLEND: Match the indirectness and specificity of clues already spoken — do not be more on-the-nose than the strongest innocent clue so far, nor obviously vaguer than the thread.
`;

  const imposterFollowRule = noCluesYet
    ? "- Imposter: you have no prior clues only when you open a round; then use the FIRST-SPEAKER rule above. Otherwise infer from others' clues and blend in."
    : "- Imposter: infer from others' clues; say one plausible word that fits the thread without revealing you are guessing.";

  return `You are playing the party word game "Imposter" (one secret word; three Innocents know it; one Imposter does not).

OFFICIAL RULES (you must follow exactly what a human would):
- 4 players, fixed seats: ${BOT_NAMES.join(", ")} (seat 0–3). Exactly ONE Imposter.
- The game has TWO rounds. In each round, every player gives exactly ONE clue in turn order, then the next round repeats for all four.
- Each clue must be a SINGLE English word: letters only (A–Z), no spaces, digits, or punctuation. Examples allowed: OCEAN, SUNSET, WAVE. Not allowed: "sea life", wave-crash, wave2.
- The clue MUST NOT be the secret word itself (any casing), nor a trivial morphological variant the table would disallow (same lemma: if word is SUN do not say SUNS).
- The clue MUST NOT contain the secret word as a substring (case-insensitive).
- Innocents: one word only; follow INNOCENT CLUE DISCIPLINE below so the Imposter cannot infer the codeword with confidence.
${imposterFollowRule}

${roleBlock}
${innocentDiscipline}${firstInnocentOpening}${firstImposterOpening}${imposterBlend}
Speaking order for every round: ${orderLine}

Clues so far:
${clueLines}

Current round to speak in: ${round}. It is now ${name}'s turn (seat ${botSeat}).

Reply with ONLY valid JSON (no markdown). The sample "word" below is format-only — you may use that word as your clue only if you truly choose it; do not output template tokens like YOURWORD or PLACEHOLDER.
{"word":"${exampleWord}","reasoning":"2–4 sentences: your thought process as this player."}

The "word" value must be ONLY the single clue word, uppercase letters A–Z. JSON only.`;
}

/**
 * @param {object} o
 * @param {string} o.secretWord
 * @param {number} o.imposterSeat
 * @param {number} o.botSeat 1-3
 * @param {{seat:number,word:string,round:number}[]} o.clues
 */
function buildBotVotePrompt(o) {
  const { secretWord, imposterSeat, botSeat, clues } = o;
  const innocent = botSeat !== imposterSeat;
  const name = BOT_NAMES[botSeat];
  const n = clues.length;
  const roundsPlayed = n >= 8 ? 2 : 1;

  const clueLines = clues
    .map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`)
    .join("\n");

  const roleBlock = innocent
    ? `You ARE an Innocent. The secret word was "${secretWord}".`
    : `You ARE the Imposter. You did not know the secret word during play.`;

  const intro =
    roundsPlayed === 2
      ? `Imposter game — voting after TWO full rounds (each player gave 2 words total).`
      : `Imposter game — voting after ONE round only (each player gave exactly 1 word). There was no second round.`;

  const weakClueLine =
    roundsPlayed === 2
      ? `3) "Weak" clue test: Before you call a clue vague or inconsistent—if Innocent, ask whether it still fits the REAL word (parts, metaphors, alternate angles). If Imposter, ask whether it fits your best hypothesis from the clues; clever round-2 specificity is NOT automatically suspicious.`
      : `3) "Weak" clue test: Before you call a clue vague—if Innocent, check it against the REAL word (parts, metaphors, alternate angles). If Imposter, check against your best hypothesis; a clue that only "clicks" late can still be innocent.`;

  return `${intro}

RULES FOR VOTING (same as humans):
- Each player votes for exactly ONE seat they believe is the Imposter.
- Seats: 0 = You (the human player), 1 = Avery, 2 = Blake, 3 = Casey.
- Use only evidence from the clues; do not use outside knowledge of the word unless you are Innocent reflecting on consistency.

PRE-VOTE CHECKLIST (follow in order; your "reasoning" must touch each item briefly—about 5 tight sentences total, no rambling):
1) Two themes: Propose two different plausible secret-word themes that fit much of the table—not only your favorite story.
2) Same lens: Judge all four players with the same strictness (don't cherry-pick one person's "off" clue).
${weakClueLine}
4) Counter-case: Give the strongest argument against your top suspect.
5) Runner-up: Name a second suspect and one line on why your pick beats them.
6) You MUST NOT vote for your own seat (${botSeat}).

All clues in order:
${clueLines}

You are ${name} (seat ${botSeat}). ${roleBlock}

Who do you vote for as the Imposter?

Reply with ONLY valid JSON:
{"vote":SEAT,"reasoning":"About 5 concise sentences following the checklist above, ending with why your vote seat is the Imposter."}

SEAT must be an integer 0, 1, 2, or 3, and NOT ${botSeat}. JSON only.`;
}

/**
 * Single prompt for all three bots’ votes (one Gemini round-trip).
 * @param {object} o
 * @param {string} o.secretWord
 * @param {number} o.imposterSeat
 * @param {{seat:number,word:string,round:number}[]} o.clues
 */
function buildBotVotesBatchPrompt(o) {
  const { secretWord, imposterSeat, clues } = o;
  const n = clues.length;
  const roundsPlayed = n >= 8 ? 2 : 1;

  const clueLines = clues
    .map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`)
    .join("\n");

  const intro =
    roundsPlayed === 2
      ? `Imposter game — voting after TWO full rounds (each player gave 2 words total).`
      : `Imposter game — voting after ONE round only (each player gave exactly 1 word). There was no second round.`;

  const weakClueLine =
    roundsPlayed === 2
      ? `3) "Weak" clue test: Before you call a clue vague or inconsistent—if Innocent, ask whether it still fits the REAL word (parts, metaphors, alternate angles). If Imposter, ask whether it fits your best hypothesis from the clues; clever round-2 specificity is NOT automatically suspicious.`
      : `3) "Weak" clue test: Before you call a clue vague—if Innocent, check it against the REAL word (parts, metaphors, alternate angles). If Imposter, check against your best hypothesis; a clue that only "clicks" late can still be innocent.`;

  const roleForSeat = (botSeat) => {
    const innocent = botSeat !== imposterSeat;
    const name = BOT_NAMES[botSeat];
    const roleBlock = innocent
      ? `Innocent; the secret word was "${secretWord}".`
      : `Imposter; you did not know the secret word during play.`;
    return `- **${name} (seat ${botSeat})**: ${roleBlock}`;
  };

  return `${intro}

You will output ONE JSON object with votes for **three** players only: seats 1 (${BOT_NAMES[1]}), 2 (${BOT_NAMES[2]}), 3 (${BOT_NAMES[3]}). The human is seat 0; they vote separately — do not invent seat 0’s vote.

RULES FOR EACH BOT’S VOTE (same as humans):
- Each votes for exactly ONE seat they believe is the Imposter (0–3).
- Each MUST NOT vote for their own seat.

PRE-VOTE CHECKLIST (each bot’s "reasoning" must touch each item briefly — about 5 tight sentences, no rambling):
1) Two themes: Propose two different plausible secret-word themes that fit much of the table—not only your favorite story.
2) Same lens: Judge all four players with the same strictness (don't cherry-pick one person's "off" clue).
${weakClueLine}
4) Counter-case: Give the strongest argument against your top suspect.
5) Runner-up: Name a second suspect and one line on why your pick beats them.

All clues in order:
${clueLines}

Roles:
${roleForSeat(1)}
${roleForSeat(2)}
${roleForSeat(3)}

Reply with ONLY valid JSON (no markdown). Include exactly three objects in "votes", one per bot seat 1, 2, and 3:
{"votes":[{"seat":1,"vote":<0-3, not 1>,"reasoning":"..."},{"seat":2,"vote":<0-3, not 2>,"reasoning":"..."},{"seat":3,"vote":<0-3, not 3>,"reasoning":"..."}]}

Each "vote" must be an integer 0, 1, 2, or 3 and must NOT equal that entry's "seat". JSON only.`;
}

/**
 * Imposter redemption: model infers the secret from other players’ clues only (no word pool).
 * Omits the Imposter’s own clues — they were bluffs without knowledge of the secret.
 * @param {{seat:number,word:string,round:number}[]} clues
 * @param {number} imposterSeat 0–3
 */
function buildRedeemGuessPrompt(clues, imposterSeat) {
  const fromInnocents = clues.filter((c) => c.seat !== imposterSeat);
  const clueLines = fromInnocents
    .map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`)
    .join("\n");

  return `In the party word game "Imposter", three Innocents share one secret English word (a single common noun) and one player is the Imposter who did not know that word while the clues were given.

Below are ONLY clues spoken by players who knew the secret (Innocents). Your own clues are omitted—you did not know the word when you spoke, so your words are not evidence of the answer.

What is the most likely secret word, based only on these one-word clues (in table order)?
${clueLines}

You are that Imposter. You were voted out and get exactly ONE chance to name the secret word and steal the win. Infer from the Innocents’ clues above only—do not assume you were given a list of possible answers.

Reply with ONLY valid JSON (no markdown):
{"word":"yourguess","reasoning":"One or two concise sentences."}

"word" must be a single English noun in lowercase, letters A–Z only (no spaces or hyphens). JSON only.`;
}

module.exports = {
  BOT_CLUE_EXAMPLE_WORDS,
  pickBotClueExampleWord,
  isBotClueArtifactWord,
  buildBotCluePrompt,
  buildBotVotePrompt,
  buildBotVotesBatchPrompt,
  buildRedeemGuessPrompt,
};
