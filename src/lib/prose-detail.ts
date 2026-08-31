/**
 * CHAOS-4669 defect 2: computation arithmetic in the lead answer prose.
 *
 * Confirmed LIVE on the kiac rig (org 70d529e0, "Which teams are struggling,
 * and why?", 0a65f124): `deterministic_answer` — the field `AnswerPanel`
 * always shows, never behind a fold (team-lead's 2026-08-30 correction) —
 * carries a templated scoring sentence verbatim:
 *
 *   "Principal driver(s): readiness gap (weight 15, value 1.00) contributed
 *    20.0 of Fullchaos's 46.7 attention points."
 *
 * This is not free LLM prose to leave untouched — it is acr's own
 * synthesis TEMPLATE for a driver's scoring contribution (the exact same
 * "(weight W, value V) contributed C of X's S attention points" shape
 * DriversPanel's own driver cards state again, structurally, per driver).
 * Splitting a templated sentence out of a field ask-dev already promises
 * never to summarize/reorder/rewrite is still consistent with that
 * boundary AS LONG AS the split is lossless: every character of the
 * original field is preserved somewhere on screen, verbatim, just moved
 * between the always-visible lead and the collapsed Details — never
 * paraphrased, dropped, or reordered relative to itself.
 *
 * Detection is sentence-level and template-anchored (`(weight <n>, value
 * <n>) contributed <n> of ... <n> attention points`), not a general
 * "sounds numeric" heuristic — a sentence with an ordinary number in it
 * (a date, a count) is left alone; only the scoring-template shape is
 * pulled out.
 */

export type ProseSplit = {
    /** The lead text with every arithmetic sentence removed, whitespace-normalized. */
    readonly lead: string;
    /** The removed sentences, in their original order, verbatim (including trailing punctuation). */
    readonly extracted: readonly string[];
};

/**
 * `(weight <n>, value <n>) contributed <n> of <subject>'s <n> attention
 * points` — acr's synthesis template for one driver's scoring contribution
 * (`internal/contextfabric` score narration; the exact same shape
 * `DriversPanel`'s own driver cards restate structurally per driver, so
 * removing it from the lead prose duplicates nothing — the structured
 * version is already one click away in "Drivers").
 */
const ARITHMETIC_SENTENCE_RE =
    /\(\s*weight\s+[\d.]+\s*,\s*value\s+[\d.]+\s*\)|contributed\s+[\d.]+\s+of\s+.*?[\d.]+\s+attention\s+points?/i;

/**
 * Splits `text` into sentences at a sentence-ending punctuation mark
 * followed by whitespace AND an uppercase letter (or `$1`'s boundary is
 * simply "whitespace after `.`/`!`/`?`, before a capital"). Safe against
 * splitting inside a decimal number: `20.0 of` has a digit immediately
 * after the decimal point, never whitespace, so the lookahead for
 * whitespace never matches there — only a genuine sentence boundary
 * (`points. Fullchaos`) has both a space AND a following capital letter.
 * Not a general-purpose sentence tokenizer (an abbreviation like "e.g. "
 * followed by a capitalized word would still split) — the same trade-off
 * the rest of this codebase makes for light rule-based text handling
 * (e.g. `humanizeTerm`, `boundedCoverageSource`) rather than pulling in an
 * NLP dependency for one narrow, templated pattern.
 */
function splitSentences(text: string): readonly string[] {
    if (text.trim() === "") return [];
    return text.split(/(?<=[.!?])\s+(?=[A-Z"“])/);
}

/**
 * Removes every arithmetic-template sentence from `text`, returning the
 * remaining lead prose (whitespace-collapsed at the removal point, so a
 * missing sentence never leaves a double space) and the removed sentences
 * verbatim, in original order. `extracted` is empty — and `lead` is
 * `text.trim()` in that case's exact original wording — for a caller
 * whose text carries no scoring-template sentence, which is the ordinary
 * case for `direct_judgment`/`current_state` and most `deterministic_answer`
 * values.
 */
export function splitLeadArithmetic(text: string): ProseSplit {
    const sentences = splitSentences(text);
    const extracted: string[] = [];
    const kept: string[] = [];
    for (const sentence of sentences) {
        if (ARITHMETIC_SENTENCE_RE.test(sentence)) {
            extracted.push(sentence.trim());
        } else {
            kept.push(sentence);
        }
    }
    if (extracted.length === 0) return { lead: text.trim(), extracted: [] };
    return { lead: kept.join(" ").trim(), extracted };
}
