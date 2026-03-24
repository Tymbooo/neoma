const { BOT_NAMES, IMPOSTER_WORDS } = require("./imposterState");

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

  const clueLines = clues.length
    ? clues.map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`).join("\n")
    : "(no clues yet)";

  const orderLine = order.map((s) => BOT_NAMES[s]).join(" → ");

  const roleBlock = innocent
    ? `You ARE an Innocent. You know the secret word is "${secretWord}".`
    : `You ARE the Imposter. You do NOT know the secret word.`;

  return `You are playing the party word game "Imposter" (one secret word; three Innocents know it; one Imposter does not).

OFFICIAL RULES (you must follow exactly what a human would):
- 4 players, fixed seats: ${BOT_NAMES.join(", ")} (seat 0–3). Exactly ONE Imposter.
- The game has TWO rounds. In each round, every player gives exactly ONE clue in turn order, then the next round repeats for all four.
- Each clue must be a SINGLE English word: letters only (A–Z), no spaces, digits, or punctuation. Examples allowed: OCEAN, SUNSET, WAVE. Not allowed: "sea life", wave-crash, wave2.
- The clue MUST NOT be the secret word itself (any casing), nor a trivial morphological variant the table would disallow (same lemma: if word is SUN do not say SUNS).
- The clue MUST NOT contain the secret word as a substring (case-insensitive).
- Innocents: say one word that relates to the secret word without making it too easy for the Imposter to guess.
- Imposter: infer from others' clues; say one plausible word that fits the thread without revealing you are guessing.

${roleBlock}

Speaking order for every round: ${orderLine}

Clues so far:
${clueLines}

Current round to speak in: ${round}. It is now ${name}'s turn (seat ${botSeat}).

Reply with ONLY valid JSON (no markdown):
{"word":"YOURWORD","reasoning":"2–4 sentences: your thought process as this player."}

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
 * Imposter redemption: one guess from the curated word pool.
 * @param {{seat:number,word:string,round:number}[]} clues
 */
function buildRedeemGuessPrompt(clues) {
  const clueLines = clues
    .map((c) => `Round ${c.round} — ${BOT_NAMES[c.seat]}: "${c.word}"`)
    .join("\n");
  const list = [...IMPOSTER_WORDS].sort().join(", ");

  return `The secret word is EXACTLY one of these English nouns (lowercase, single word):
${list}

Imposter party game — these clues were spoken (one word per turn; the Imposter did not know the word while playing):
${clueLines}

You ARE that Imposter. You were voted out. You get ONE chance to name the secret word and steal the win.

Pick the single noun from the list above that best fits ALL clues (including subtle angles). Do not pick a word that only fits early clues if another fits the full picture better.

Reply with ONLY valid JSON:
{"word":"yourguess","reasoning":"One concise sentence."}

"word" must match one list entry exactly (lowercase). JSON only.`;
}

module.exports = { buildBotCluePrompt, buildBotVotePrompt, buildRedeemGuessPrompt };
