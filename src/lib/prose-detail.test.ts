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
