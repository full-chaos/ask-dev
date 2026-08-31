import { describe, expect, it } from "vitest";

import { splitLeadArithmetic } from "@/lib/prose-detail";

/**
 * CHAOS-4669 defect 2. `LIVE_DETERMINISTIC_ANSWER` is verbatim from a real
 * kiac investigation (org 70d529e0, "Which teams are struggling, and why?",
 * acr 0a65f124, 2026-08-31) — captured live via Playwright against the
 * private rig, not invented.
 */
const LIVE_DETERMINISTIC_ANSWER =
    "This investigation is partial: some canonical or graph coverage was unavailable. " +
    "Principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points. " +
    "Fullchaos has an operational deficiency with severity warning.";

describe("splitLeadArithmetic: CHAOS-4669 defect 2 (computation arithmetic out of the lead prose)", () => {
    it("removes the exact live scoring-template sentence and preserves the rest verbatim", () => {
        const result = splitLeadArithmetic(LIVE_DETERMINISTIC_ANSWER);
        expect(result.extracted).toHaveLength(1);
        expect(result.extracted[0]).toBe(
            "Principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points.",
        );
        expect(result.lead).not.toContain("weight 15");
        expect(result.lead).not.toContain("attention points");
        // Every OTHER sentence survives, verbatim, in order.
        expect(result.lead).toContain(
            "This investigation is partial: some canonical or graph coverage was unavailable.",
        );
        expect(result.lead).toContain(
            "Fullchaos has an operational deficiency with severity warning.",
        );
    });

    it("is lossless: every character of an extracted sentence is preserved, not paraphrased", () => {
        const raw =
            "operational deficiencies (weight 20, value 0.50) contributed 13.3 of Fullchaos's 46.7 attention points.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toEqual([raw]);
    });

    it("does not split or remove a decimal number mid-sentence (no false sentence boundary)", () => {
        const raw =
            "Pipeline success rate is 20.0 percent this week, which is unusually low for the team.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toHaveLength(0);
        expect(result.lead).toBe(raw);
    });

    it("leaves an ordinary numeric sentence (a date, a count) untouched — narrow template match, not 'any number'", () => {
        const raw = "The backlog grew to 22 items by 2026-08-26, up from 15 the prior week.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toHaveLength(0);
        expect(result.lead).toBe(raw);
    });

    it("returns the original text unchanged when there is nothing to extract", () => {
        const raw =
            "Ask Dev is not release-ready even though most tracked implementation work is closed.";
        const result = splitLeadArithmetic(raw);
        expect(result).toEqual({ lead: raw, extracted: [] });
    });

    it("handles multiple arithmetic sentences in one field, extracting all of them in order", () => {
        const raw =
            "Readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points. " +
            "Workload pressure (weight 10, value 1.00) contributed 13.3 of Fullchaos's 46.7 attention points.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toHaveLength(2);
        expect(result.lead).toBe("");
    });

    it("handles empty text", () => {
        expect(splitLeadArithmetic("")).toEqual({ lead: "", extracted: [] });
    });

    /**
     * codex round 1, finding 1 (EXECUTED repro): a lowercase continuation
     * after the conclusion sentence's period ("... blocked. principal
     * driver(s): ...") is contract-valid but is not a signal this module
     * can require — the fix drops the capital-letter lookahead entirely
     * and relies only on "punctuation then whitespace" (still safe against
     * decimals, which never have a space after the point).
     */
    it("splits a conclusion sentence from a LOWERCASE-continuing arithmetic sentence (codex round 1, finding 1)", () => {
        const raw =
            "The organization is blocked. principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Atlas's 46.7 attention points.";
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe("The organization is blocked.");
        expect(result.extracted).toEqual([
            "principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Atlas's 46.7 attention points.",
        ]);
    });

    /**
     * codex round 1, finding 2 (EXECUTED repro): the old regex was an OR of
     * the two clauses, so a sentence carrying ONLY a parenthesized
     * weight/value (no "contributed ... attention points") was extracted
     * too, even though it was not the templated scoring sentence — capable
     * of hiding a genuine judgment sentence and falsely reporting "no
     * direct judgment". Both clauses must now appear together.
     */
    it("does NOT extract a sentence carrying only a parenthesized weight/value with no 'contributed ... attention points' (codex round 1, finding 2)", () => {
        const raw = "The team's plan notes a (weight 15, value 1.00) placeholder pending review.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toHaveLength(0);
        expect(result.lead).toBe(raw);
    });

    /**
     * codex round 3, finding 2 (EXECUTED repro): the splitter only breaks at
     * `.`/`!`/`?` followed by whitespace, so a genuine conclusion joined to
     * the scoring clause by a semicolon (no terminal punctuation between
     * them) was ONE "sentence" as far as the splitter was concerned — the
     * whole fragment, conclusion included, was swallowed into `extracted`,
     * leaving `lead` empty even though a real, non-arithmetic judgment was
     * right there. A semicolon is as much a fragment boundary as a period
     * for this narrow, rule-based splitter (same decimal-safety argument
     * applies: a semicolon is never adjacent to a digit either side of a
     * decimal point).
     */
    it("keeps a real conclusion that shares a semicolon-joined fragment with the scoring clause (codex round 3, finding 2)", () => {
        const raw =
            "The release is blocked because approval is missing; principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Atlas's 46.7 attention points.";
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe("The release is blocked because approval is missing;");
        expect(result.extracted).toEqual([
            "principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Atlas's 46.7 attention points.",
        ]);
    });
});

/**
 * codex R4 pre-round sweep (chris/orchestrator, 2026-08-31 ~12:35 PDT):
 * three rounds each found a NEW edge case in this splitter (round 1: the
 * capital-letter lookahead, the OR-vs-AND clause requirement; round 3: the
 * semicolon boundary), so instead of a fourth narrow-diff round, this
 * exhausts the decision space directly: boundary punctuation (`.`/`!`/`?`/
 * `;`/none) x clause placement (arithmetic leads / conclusion leads / mid,
 * with the arithmetic clause between two conclusions) x the decimal and
 * lowercase-continuation hazards already covered above.
 *
 * ACCEPTED LIMITATION, flagged rather than silently left (per standing
 * instruction to name rather than guess): a conclusion and the arithmetic
 * clause joined with NO punctuation boundary at all (a bare conjunction —
 * "... and the team continues investigating", "The release is blocked and
 * readiness gap ... attention points.") is, by definition, not something a
 * PUNCTUATION-boundary splitter can separate — there is no character to
 * split on. `splitSentences`'s own doc comment already declines an NLP
 * dependency for this module; the two cells below pin the current,
 * accepted behavior (the whole fused run-on is extracted, including the
 * conclusion) rather than leaving it as an unconsidered gap. This is a
 * DIFFERENT class from round 3's semicolon finding — that one had a real,
 * unhandled boundary character; these two have none.
 */
describe("splitLeadArithmetic: exhaustive boundary/placement truth table (codex R4 pre-round sweep)", () => {
    const ARITH =
        "readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points";
    const CONCLUSION_A = "The release is blocked because approval is missing";
    const CONCLUSION_B = "Fullchaos has an operational deficiency with severity warning";

    it.each([
        { boundary: ".", label: "period" },
        { boundary: "!", label: "exclamation" },
        { boundary: "?", label: "question mark" },
    ])("arithmetic LEADS, conclusion TRAILS, joined by $label", ({ boundary }) => {
        const raw = `Principal driver(s): ${ARITH}${boundary} ${CONCLUSION_B}.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe(`${CONCLUSION_B}.`);
        expect(result.extracted).toEqual([`Principal driver(s): ${ARITH}${boundary}`]);
    });

    it("arithmetic LEADS, conclusion TRAILS, joined by a semicolon", () => {
        const raw = `Principal driver(s): ${ARITH}; ${CONCLUSION_B}.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe(`${CONCLUSION_B}.`);
        expect(result.extracted).toEqual([`Principal driver(s): ${ARITH};`]);
    });

    it("ACCEPTED LIMITATION: arithmetic LEADS, conclusion TRAILS, joined by NO punctuation (bare conjunction) — whole run-on is extracted", () => {
        const raw = `Principal driver(s): ${ARITH} and the team continues investigating.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe("");
        expect(result.extracted).toEqual([raw]);
    });

    it.each([
        { boundary: ".", label: "period" },
        { boundary: "!", label: "exclamation" },
        { boundary: "?", label: "question mark" },
    ])("conclusion LEADS, arithmetic TRAILS, joined by $label", ({ boundary }) => {
        const raw = `${CONCLUSION_A}${boundary} Principal driver(s): ${ARITH}.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe(`${CONCLUSION_A}${boundary}`);
        expect(result.extracted).toEqual([`Principal driver(s): ${ARITH}.`]);
    });

    // Conclusion-leads-via-semicolon is already pinned above (round 3, finding 2).

    it("ACCEPTED LIMITATION: conclusion LEADS, arithmetic TRAILS, joined by NO punctuation (bare conjunction) — whole run-on is extracted", () => {
        const raw = `The release is blocked and ${ARITH}.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe("");
        expect(result.extracted).toEqual([raw]);
    });

    it("MID placement with MIXED boundaries composes correctly: conclusion, period, arithmetic, semicolon, conclusion", () => {
        const raw = `${CONCLUSION_A}. Principal driver(s): ${ARITH}; ${CONCLUSION_B}.`;
        const result = splitLeadArithmetic(raw);
        expect(result.lead).toBe(`${CONCLUSION_A}. ${CONCLUSION_B}.`);
        expect(result.extracted).toEqual([`Principal driver(s): ${ARITH};`]);
    });

    it("a single-clause-only fragment next to a semicolon is still not extracted, and the text is untouched", () => {
        const raw =
            "The team's plan notes a (weight 15, value 1.00) placeholder; nothing has shipped yet.";
        const result = splitLeadArithmetic(raw);
        expect(result.extracted).toHaveLength(0);
        expect(result.lead).toBe(raw);
    });
});
