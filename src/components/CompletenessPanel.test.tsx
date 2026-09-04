import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompletenessPanel } from "@/components/CompletenessPanel";
import type { AnswerCompleteness } from "@/lib/contracts";

/**
 * CHAOS-4413/CHAOS-4642: `completeness` is a REQUIRED field on the pinned
 * `context_fabric_investigation_result.v1` contract from this pin onward —
 * every result carries it, so this panel always renders something, never a
 * conditional "if present" gate the way `temporal`/`window_clarification`
 * (genuinely optional fields) are handled elsewhere.
 */
describe("CompletenessPanel", () => {
    it("shows the terminal status as visible chip text, not just a color", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(within(panel).getByTestId("completeness-chip-row")).toHaveTextContent("complete");
    });

    it("shows the claimed-facts and row counts", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(panel).toHaveTextContent("4 claimed facts");
        expect(panel).toHaveTextContent("2 rows");
    });

    it("singularizes a count of exactly one", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 1,
            rows_count: 1,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        const panel = screen.getByTestId("completeness-panel");
        expect(panel).toHaveTextContent("1 claimed fact · 1 row");
        expect(panel).not.toHaveTextContent("1 claimed facts");
        expect(panel).not.toHaveTextContent("1 rows");
    });

    /**
     * `terminal_reason` is ABSENT exactly when `terminal_status` is
     * `complete` (the schema's own conditional) — there is nothing to
     * disclose, so this panel must not invent one.
     */
    it("shows no terminal reason when the answer is complete", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "complete",
            claimed_facts_count: 4,
            rows_count: 2,
            state: "not_derived",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.queryByTestId("completeness-terminal-reason")).not.toBeInTheDocument();
    });

    /**
     * Present and one of the closed values on every non-complete status —
     * never the engine's or a model's own raw text (schema doc comment on
     * `AnswerCompleteness.terminal_reason`).
     */
    it("shows the terminal reason verbatim when the answer stopped short", () => {
        const completeness: AnswerCompleteness = {
            terminal_status: "partial",
            terminal_reason: "limitation_disclosed",
            claimed_facts_count: 2,
            rows_count: 0,
            state: "partial",
        };
        render(<CompletenessPanel completeness={completeness} />);
        expect(screen.getByTestId("completeness-terminal-reason")).toHaveTextContent(
            "limitation disclosed",
        );
    });
});
