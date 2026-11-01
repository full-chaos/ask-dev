import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FailurePanel } from "@/components/FailurePanel";
import type { WorkbenchFailure } from "@/lib/acr/errors";

const budgetRefusalFailure: WorkbenchFailure = {
    code: "acr_rejected_request",
    httpStatus: 413,
    maxItems: 25,
    measuredItems: 42,
    message: "ACR rejected the investigation request.",
    narrowerContinuation: { axis: "result_count", family: "discovered_cohort_ranking" },
    overrun: "items",
    retryable: false,
};

describe("FailurePanel — details", () => {
    it("logs what a failure's details say, because no user reads them", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const failure: WorkbenchFailure = {
            code: "acr_contract_violation",
            details: ["/deterministic_answer: must be object"],
            message: "The answer could not be read.",
            retryable: false,
        };
        render(<FailurePanel failure={failure} />);

        expect(logged).toHaveBeenCalledExactlyOnceWith(
            "investigation failed",
            "acr_contract_violation",
            failure.details,
        );
        expect(screen.queryByText(/deterministic_answer/u)).toBeNull();
        logged.mockRestore();
    });

    it("logs nothing for a failure with no details", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        render(
            <FailurePanel
                failure={{ code: "acr_timeout", message: "Timed out.", retryable: true }}
            />,
        );

        expect(logged).not.toHaveBeenCalled();
        logged.mockRestore();
    });
});

/**
 * CHAOS-5107: `FailurePanel` gates the one-click narrower re-ask on the SAME
 * three things `onRetry` already requires (present continuation, an
 * original question, and a caller that wants the callback) — but NOT on
 * `retryable`, since a 413 budget refusal is never retryable and IS exactly
 * when this fires.
 */
describe("FailurePanel — CHAOS-5107 narrower re-ask wiring", () => {
    it("renders the narrower re-ask when a continuation, a question, and a callback are all present", () => {
        render(
            <FailurePanel
                failure={budgetRefusalFailure}
                onNarrowerReask={vi.fn()}
                originalQuestion="Which teams are struggling, and why?"
            />,
        );

        expect(screen.getByRole("button", { name: "Ask for fewer results" })).toBeInTheDocument();
        // A 413 is not retryable — no Retry button, on purpose.
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("renders nothing extra when the failure carries no continuation", () => {
        render(
            <FailurePanel
                failure={{ ...budgetRefusalFailure, narrowerContinuation: undefined }}
                onNarrowerReask={vi.fn()}
                originalQuestion="Which teams are struggling, and why?"
            />,
        );

        expect(screen.queryByRole("button", { name: "Ask for fewer results" })).toBeNull();
    });

    it("renders nothing when no callback is wired (e.g. the Workbench legacy panel)", () => {
        render(
            <FailurePanel
                failure={budgetRefusalFailure}
                originalQuestion="Which teams are struggling?"
            />,
        );

        expect(screen.queryByRole("button", { name: "Ask for fewer results" })).toBeNull();
    });

    it("renders nothing when no original question is available (a receipt-carrying re-ask)", () => {
        render(<FailurePanel failure={budgetRefusalFailure} onNarrowerReask={vi.fn()} />);

        expect(screen.queryByRole("button", { name: "Ask for fewer results" })).toBeNull();
    });

    /**
     * codex review round 1, P2: an empty (or whitespace-only) original
     * question passed the old `!== undefined` gate and would have built a
     * re-ask question that is just the appended clause with nothing in
     * front of it.
     */
    it("renders nothing when the original question is empty or whitespace-only", () => {
        render(
            <FailurePanel
                failure={budgetRefusalFailure}
                onNarrowerReask={vi.fn()}
                originalQuestion="   "
            />,
        );

        expect(screen.queryByRole("button", { name: "Ask for fewer results" })).toBeNull();
    });

    /**
     * codex review round 2, P2: a question consisting only of the
     * punctuation the copy module strips (`"???"`) passed the round-1
     * `.trim() !== ""` gate, then built a re-ask question that was that
     * same punctuation with a clause appended — nothing meaningful was
     * ever there.
     */
    it("renders nothing when the original question is punctuation-only", () => {
        render(
            <FailurePanel
                failure={budgetRefusalFailure}
                onNarrowerReask={vi.fn()}
                originalQuestion="???"
            />,
        );

        expect(screen.queryByRole("button", { name: "Ask for fewer results" })).toBeNull();
    });

    it("calls onNarrowerReask with a narrowed question, never the bare original, on click", async () => {
        const user = userEvent.setup();
        const onNarrowerReask = vi.fn();

        render(
            <FailurePanel
                failure={budgetRefusalFailure}
                onNarrowerReask={onNarrowerReask}
                originalQuestion="Which teams are struggling, and why?"
            />,
        );
        await user.click(screen.getByRole("button", { name: "Ask for fewer results" }));

        expect(onNarrowerReask).toHaveBeenCalledTimes(1);
        expect(onNarrowerReask.mock.calls[0]![0]).not.toBe("Which teams are struggling, and why?");
    });
});
