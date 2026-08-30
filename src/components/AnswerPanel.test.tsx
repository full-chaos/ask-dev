import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerPanel } from "@/components/AnswerPanel";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

const base = mockScenarios().find((s) => s.id === "complete")!.result;

/**
 * CHAOS-4581: the prose stays to one paragraph by default —
 * `deterministic_answer` only — with `direct_judgment`/`current_state`
 * (where a long fact dump tends to land) collapsed behind a closed
 * `<details>` rather than always inline.
 */
describe("AnswerPanel — short by default, full text behind a disclosure (CHAOS-4581)", () => {
    it("shows deterministic_answer directly and collapses the rest by default", () => {
        render(<AnswerPanel result={base} />);

        expect(screen.getByText(base.deterministic_answer)).toBeInTheDocument();

        const details = screen.getByText("Full answer").closest("details");
        expect(details).not.toBeNull();
        expect(details).not.toHaveAttribute("open");
        expect(screen.getByText(base.direct_judgment)).toBeInTheDocument();
        expect(screen.getByText(base.current_state)).toBeInTheDocument();
    });

    it("opens the full answer on click", () => {
        render(<AnswerPanel result={base} />);
        const summary = screen.getByText("Full answer");
        summary.click();
        const details = summary.closest("details")!;
        expect(details).toHaveAttribute("open");
    });

    it("keeps the honest 'no direct judgment' message when there is nothing to disclose", () => {
        const result: InvestigationResult = { ...base, direct_judgment: "", current_state: "" };
        render(<AnswerPanel result={result} />);

        expect(screen.getByText(base.deterministic_answer)).toBeInTheDocument();
        expect(screen.getByText("The service returned no direct judgment.")).toBeInTheDocument();
        expect(screen.queryByText("Full answer")).toBeNull();
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
