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
 * CHAOS-4669 defect 2. `LIVE_DETERMINISTIC_ANSWER` is verbatim from a real
 * kiac investigation (org 70d529e0, "Which teams are struggling, and why?",
 * acr 0a65f124, 2026-08-31) — captured live via Playwright against a
 * private rig, not invented (screenshot:
 * lane-4669-4673-q2-before-defect2-fix.png / -after-defect2-fix.png).
 */
describe("AnswerPanel — CHAOS-4669 defect 2: computation arithmetic moves behind Details", () => {
    const LIVE_DETERMINISTIC_ANSWER =
        "This investigation is partial: some canonical or graph coverage was unavailable. " +
        "Principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points. " +
        "Fullchaos has an operational deficiency with severity warning.";

    it("never shows the raw scoring arithmetic in the always-visible lead paragraph", () => {
        const result: InvestigationResult = {
            ...base,
            deterministic_answer: LIVE_DETERMINISTIC_ANSWER,
        };
        render(<AnswerPanel result={result} />);

        const judgment = screen.getByText(/This investigation is partial/);
        expect(judgment.textContent).not.toContain("weight 15");
        expect(judgment.textContent).not.toContain("attention points");
        // The non-arithmetic sentences survive, verbatim, on the lead surface.
        expect(judgment.textContent).toContain(
            "This investigation is partial: some canonical or graph coverage was unavailable.",
        );
        expect(judgment.textContent).toContain(
            "Fullchaos has an operational deficiency with severity warning.",
        );
    });

    it("keeps the extracted sentence reachable, verbatim, behind the collapsed More detail disclosure", () => {
        const result: InvestigationResult = {
            ...base,
            deterministic_answer: LIVE_DETERMINISTIC_ANSWER,
        };
        render(<AnswerPanel result={result} />);

        const details = screen.getByText("More detail").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        expect(
            screen.getByText(
                "Principal driver(s): readiness gap (weight 15, value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points.",
            ),
        ).toBeInTheDocument();
    });

    it("opens the More detail disclosure even when current_state is empty, as long as arithmetic was extracted", () => {
        const result: InvestigationResult = {
            ...base,
            deterministic_answer: LIVE_DETERMINISTIC_ANSWER,
            current_state: "",
        };
        render(<AnswerPanel result={result} />);
        expect(screen.getByText("More detail")).toBeInTheDocument();
    });

    it("does the same for direct_judgment, not just deterministic_answer", () => {
        const result: InvestigationResult = {
            ...base,
            direct_judgment:
                "Fullchaos is struggling. Operational deficiencies (weight 20, value 0.50) contributed 13.3 of Fullchaos's 46.7 attention points.",
        };
        render(<AnswerPanel result={result} />);
        const judgment = screen.getByText(/Fullchaos is struggling\./);
        expect(judgment.textContent).not.toContain("weight 20");
        expect(
            screen.getByText(
                "Operational deficiencies (weight 20, value 0.50) contributed 13.3 of Fullchaos's 46.7 attention points.",
            ),
        ).toBeInTheDocument();
    });
});
