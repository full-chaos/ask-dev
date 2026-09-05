import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NarrowerReask } from "@/components/NarrowerReask";

/**
 * CHAOS-5107 (CHAOS-4735's client half): the renderer for a 413 budget
 * refusal's `narrower_continuation`.
 *
 * The corpus's own question text NEVER appears here — every fixture below
 * uses an obviously-made-up tester question, and every assertion checks
 * that ONLY the tester's own text (plus a client-authored clause) comes
 * back out.
 */
describe("NarrowerReask", () => {
    it("renders axis-specific client-authored copy and narrows the tester's own question on click", async () => {
        const user = userEvent.setup();
        const onReask = vi.fn();

        render(
            <NarrowerReask
                narrowerContinuation={{ axis: "result_count", family: "discovered_cohort_ranking" }}
                onReask={onReask}
                originalQuestion="Which teams are struggling, and why?"
            />,
        );

        expect(screen.getByText(/more results than fit one response/i)).toBeInTheDocument();
        const button = screen.getByRole("button", { name: "Ask for fewer results" });

        await user.click(button);

        expect(onReask).toHaveBeenCalledTimes(1);
        const narrowedQuestion = onReask.mock.calls[0]![0] as string;
        expect(narrowedQuestion).toContain("Which teams are struggling, and why");
        expect(narrowedQuestion).not.toBe("Which teams are struggling, and why?");
    });

    it("renders distinct copy per axis (the copy table is keyed, not a single sentence)", () => {
        const { rerender } = render(
            <NarrowerReask
                narrowerContinuation={{ axis: "evidence_window", family: "trend" }}
                onReask={vi.fn()}
                originalQuestion="How has cycle time moved?"
            />,
        );
        expect(
            screen.getByRole("button", { name: "Ask over a shorter window" }),
        ).toBeInTheDocument();

        rerender(
            <NarrowerReask
                narrowerContinuation={{ axis: "comparison_pair", family: "explicit_comparison" }}
                onReask={vi.fn()}
                originalQuestion="Compare Atlas to Orion over 90 days"
            />,
        );
        expect(screen.getByRole("button", { name: "Compare fewer subjects" })).toBeInTheDocument();
    });

    it("describes the measured overrun from closed-vocabulary counts only, never from upstream prose", () => {
        render(
            <NarrowerReask
                maxItems={25}
                measuredItems={42}
                narrowerContinuation={{ axis: "result_count", family: "discovered_cohort_ranking" }}
                onReask={vi.fn()}
                originalQuestion="Which teams are struggling, and why?"
                overrun="items"
            />,
        );

        expect(screen.getByText(/would have included 42 items; only 25 fit/i)).toBeInTheDocument();
    });

    it("disables the button while pending", () => {
        render(
            <NarrowerReask
                narrowerContinuation={{ axis: "scope_anchor", family: "scoped_cohort_status" }}
                onReask={vi.fn()}
                originalQuestion="What are the statuses of fullchaos's projects?"
                pending
            />,
        );

        expect(screen.getByRole("button", { name: "Asking…" })).toBeDisabled();
    });

    it("never renders the corpus/example question — only the tester's own text feeds the narrowed question", async () => {
        const user = userEvent.setup();
        const onReask = vi.fn();
        const testerQuestion = "zzz-tester-typed-this-exact-string-not-a-corpus-question";

        render(
            <NarrowerReask
                narrowerContinuation={{ axis: "group_selection", family: "grouped_cohort_status" }}
                onReask={onReask}
                originalQuestion={testerQuestion}
            />,
        );
        await user.click(screen.getByRole("button", { name: "Ask about fewer groups" }));

        const narrowedQuestion = onReask.mock.calls[0]![0] as string;
        expect(narrowedQuestion).toContain(testerQuestion);
    });
});
