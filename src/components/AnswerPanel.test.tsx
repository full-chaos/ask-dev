import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerPanel } from "@/components/AnswerPanel";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

const base = mockScenarios().find((s) => s.id === "complete")!.result;

/**
 * CHAOS-4581: the one-line answer is never hidden behind a click
 * (team-lead correction, 2026-08-30) — `deterministic_answer` AND
 * `direct_judgment` (the judgment sentence, or an explicit "no direct
 * judgment") are both always visible. Only `current_state` — where a long
 * fact dump tends to land — collapses behind a closed `<details>`.
 */
describe("AnswerPanel — the answer/judgment stay visible, only current_state collapses (CHAOS-4581)", () => {
    it("shows deterministic_answer and direct_judgment directly, without a click", () => {
        render(<AnswerPanel result={base} />);

        expect(screen.getByText(base.deterministic_answer)).toBeInTheDocument();
        expect(screen.getByText(base.direct_judgment)).toBeInTheDocument();
    });

    it("collapses current_state behind a closed disclosure by default", () => {
        render(<AnswerPanel result={base} />);

        const details = screen.getByText("More detail").closest("details");
        expect(details).not.toBeNull();
        expect(details).not.toHaveAttribute("open");
        expect(screen.getByText(base.current_state)).toBeInTheDocument();
    });

    it("opens current_state on click", () => {
        render(<AnswerPanel result={base} />);
        const summary = screen.getByText("More detail");
        summary.click();
        const details = summary.closest("details")!;
        expect(details).toHaveAttribute("open");
    });

    it("renders no disclosure at all when current_state is empty", () => {
        const result: InvestigationResult = { ...base, current_state: "" };
        render(<AnswerPanel result={result} />);

        expect(screen.getByText(base.deterministic_answer)).toBeInTheDocument();
        expect(screen.getByText(base.direct_judgment)).toBeInTheDocument();
        expect(screen.queryByText("More detail")).toBeNull();
    });

    it("keeps the honest 'no direct judgment' message visible, never collapsed", () => {
        const result: InvestigationResult = { ...base, direct_judgment: "", current_state: "" };
        render(<AnswerPanel result={result} />);

        expect(screen.getByText(base.deterministic_answer)).toBeInTheDocument();
        expect(screen.getByText("The service returned no direct judgment.")).toBeInTheDocument();
        expect(screen.queryByText("More detail")).toBeNull();
    });

    it("gives each mounted instance its own heading id (CHAOS-4510)", () => {
        const other: InvestigationResult = { ...base, result_id: "result_other" };
        render(
            <>
                <AnswerPanel result={base} />
                <AnswerPanel result={other} />
            </>,
        );
        const [first, second] = screen.getAllByTestId("answer-panel");
        const firstId = first!.getAttribute("aria-labelledby");
        const secondId = second!.getAttribute("aria-labelledby");
        expect(firstId).not.toBe(secondId);
        expect(first!.querySelector(`#${CSS.escape(firstId!)}`)).not.toBeNull();
        expect(second!.querySelector(`#${CSS.escape(secondId!)}`)).not.toBeNull();
    });
});

/**
 * CHAOS-4690/CHAOS-4691. CHAOS-4669 defect 2 fixed this at the CLIENT — a
 * sentence-splitting helper in the module this ticket deletes entirely
 * (`prose-detail.ts`) stripped acr's driver-scoring TEMPLATE sentence out of
 * `deterministic_answer`/`direct_judgment` (live-confirmed on org 70d529e0,
 * acr 0a65f124). The sibling engine ticket fixed it at the SOURCE instead:
 * acr's cohort lead recomposition no longer splices that template into
 * either field, so the client-side parser has nothing left to do — and it
 * is deleted (chris's strike-three ruling: a consumer-side text parser over
 * the service's own prose does not get hardened a second time, it ceases to
 * exist). `deterministic_answer`/`direct_judgment` now render in FULL,
 * verbatim, exactly as the field arrived — proven here by a string carrying
 * the OLD arithmetic shape and asserting it is untouched, which would fail
 * the moment an equivalent sentence-splitting pass is reintroduced.
 */
describe("AnswerPanel — CHAOS-4690/4691: deterministic_answer/direct_judgment render whole, unparsed", () => {
    const ARITHMETIC_SHAPED_ANSWER =
        "This investigation is partial: some canonical or graph coverage was unavailable. " +
        "Principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points. " +
        "Fullchaos has an operational deficiency with severity warning.";

    it("renders deterministic_answer in full on the lead surface, including an arithmetic-shaped sentence, never split into a fold", () => {
        const result: InvestigationResult = {
            ...base,
            deterministic_answer: ARITHMETIC_SHAPED_ANSWER,
            current_state: "",
        };
        render(<AnswerPanel result={result} />);

        expect(screen.getByText(ARITHMETIC_SHAPED_ANSWER)).toBeInTheDocument();
        // No "More detail" disclosure is minted for this alone — the field
        // has nowhere to be split to now that there is no parser.
        expect(screen.queryByText("More detail")).toBeNull();
    });

    it("renders direct_judgment in full too, not just deterministic_answer", () => {
        const arithmeticJudgment =
            "Fullchaos is struggling. Operational deficiencies (weight 20, value 0.50) contributed 13.3 of Fullchaos's 46.7 attention points.";
        const result: InvestigationResult = {
            ...base,
            direct_judgment: arithmeticJudgment,
            current_state: "",
        };
        render(<AnswerPanel result={result} />);

        expect(screen.getByText(arithmeticJudgment)).toBeInTheDocument();
        expect(screen.queryByText("More detail")).toBeNull();
    });
});

/**
 * Team-lead ruling (round 3 close-out): every render-site blank-content
 * decision in this ticket's diff routes through `nonBlank` (`@/lib/
 * presentation`), which itself carries the exhaustive category sweep
 * (`presentation.test.ts`'s own `nonBlank` table). This proves the WIRING
 * at this specific terminus — `direct_judgment` consisting of only a
 * zero-width character is schema-valid (`minLength` absent on this field)
 * and must fall to the honest "no direct judgment" message, never render
 * an invisible paragraph.
 */
describe("AnswerPanel — codex round 3/4 close-out: blank-content decisions route through nonBlank", () => {
    it("treats a direct_judgment consisting of only invisible characters as absent (falls to the honest message)", () => {
        const result: InvestigationResult = { ...base, direct_judgment: "\u200B\u2066" };
        render(<AnswerPanel result={result} />);
        expect(screen.getByText("The service returned no direct judgment.")).toBeInTheDocument();
        expect(screen.queryByText("\u200B\u2066")).toBeNull();
    });
});
