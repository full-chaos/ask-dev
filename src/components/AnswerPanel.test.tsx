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
