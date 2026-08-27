import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { validateContract } from "@/lib/acr/validate";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * The clarification flow (CHAOS-3738; multi-select CHAOS-4343).
 *
 * The fixture is a schema-valid `clarification_required` result, not a
 * fabricated ANSWER. The no-mock-results boundary forbids presenting invented
 * answers as answers; exercising the Workbench's own choice UI against a
 * contract-shaped clarification is a component test, and it is the only way to
 * have this path working before CHAOS-3810 lands — which is precisely when it
 * becomes the first real non-error result a tester will see.
 */
const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;

describe("clarification fixture", () => {
    it("is a contract-valid clarification_required result", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            clarification,
        );
        expect(validation.valid, validation.errors.join("; ")).toBe(true);
        expect(clarification.status).toBe("clarification_required");
        expect(clarification.subject_resolution.candidates.length).toBeGreaterThan(1);
        expect(clarification.subject_resolution.committed).toHaveLength(0);
    });
});

describe("clarification flow", () => {
    it("leads with the choice rather than an empty answer", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        expect(
            screen.getByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        // The judgment panels must NOT appear: a clarification is not a thin
        // answer, and showing empty driver/finding sections above the choice
        // would present it as one.
        expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Remaining work" })).toBeNull();
    });

    it("shows the service's own prompt, never one of its own", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        expect(
            screen.getByText(clarification.subject_resolution.clarification_prompt!),
        ).toBeInTheDocument();
    });

    it("shows every candidate with its receipt, rank, confidence and reasons", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        const panel = screen.getByRole("region", { name: "Which subject did you mean?" });
        for (const candidate of clarification.subject_resolution.candidates) {
            expect(within(panel).getByText(candidate.receipt_id)).toBeInTheDocument();
            expect(within(panel).getByText(candidate.subject.label)).toBeInTheDocument();
            for (const reason of candidate.match_reasons) {
                expect(within(panel).getByText(reason)).toBeInTheDocument();
            }
        }
        expect(within(panel).getByText("#1")).toBeInTheDocument();
        expect(within(panel).getByText("#2")).toBeInTheDocument();
    });

    /**
     * Ranking is part of the answer. Re-sorting candidates by confidence — or
     * anything else — would be the presentation layer quietly forming a
     * judgment ACR did not make.
     */
    it("preserves ACR's candidate order", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        const buttons = screen
            .getAllByRole("button", { name: /^Select / })
            .map((button) => button.textContent);
        expect(buttons).toEqual(
            clarification.subject_resolution.candidates.map(
                (candidate) => `Select ${candidate.subject.label}`,
            ),
        );
    });

    /**
     * CHAOS-4343 items 1/2: selection leads, confirming follows — mirrors
     * `StructureNeedsPanel`'s own "select, then confirm" discipline. A single
     * toggle must not fire a request by itself.
     */
    it("toggling a candidate calls onToggle with its receipt id, and does not confirm by itself", async () => {
        const onToggle = vi.fn();
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <DeterministicAnswerView
                onConfirmCandidates={onConfirm}
                onToggleCandidate={onToggle}
                result={clarification}
            />,
        );

        const second = clarification.subject_resolution.candidates[1]!;
        await user.click(screen.getByRole("button", { name: `Select ${second.subject.label}` }));

        expect(onToggle).toHaveBeenCalledWith(second.receipt_id);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    /**
     * The choice travels as ACR's OWN receipt, never as a re-typed subject
     * name — so the Workbench never names or authorizes a subject on the
     * tester's behalf.
     */
    it("confirming a single selection sends that candidate's receipt bound to this result", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        const second = clarification.subject_resolution.candidates[1]!;
        render(
            <DeterministicAnswerView
                onConfirmCandidates={onConfirm}
                onToggleCandidate={vi.fn()}
                result={clarification}
                selectedCandidateReceiptIds={new Set([second.receipt_id])}
            />,
        );

        await user.click(screen.getByRole("button", { name: /^Ask about 1 selected candidate$/ }));

        expect(onConfirm).toHaveBeenCalledWith([
            { result_id: clarification.result_id, receipt_id: second.receipt_id },
        ]);
    });

    /**
     * Item 2: N selections confirm as N entries, in ACR's OWN candidate
     * order — never the order the tester happened to click them in.
     */
    it("confirming multiple selections sends every chosen candidate's receipt, in ACR's order", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        const [first, second] = clarification.subject_resolution.candidates;
        render(
            <DeterministicAnswerView
                onConfirmCandidates={onConfirm}
                onToggleCandidate={vi.fn()}
                result={clarification}
                // Selected out of ACR's own order (second before first) —
                // the confirmed payload must still come back first-then-second.
                selectedCandidateReceiptIds={new Set([second!.receipt_id, first!.receipt_id])}
            />,
        );

        await user.click(screen.getByRole("button", { name: /^Ask about 2 selected candidates$/ }));

        expect(onConfirm).toHaveBeenCalledWith([
            { result_id: clarification.result_id, receipt_id: first!.receipt_id },
            { result_id: clarification.result_id, receipt_id: second!.receipt_id },
        ]);
    });

    it("disables the confirm action until at least one candidate is selected", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Ask about the selected candidates" }),
        ).toBeDisabled();
    });

    it("shows a selected badge on a chosen candidate", () => {
        const first = clarification.subject_resolution.candidates[0]!;
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
                selectedCandidateReceiptIds={new Set([first.receipt_id])}
            />,
        );

        expect(
            screen.getByRole("button", { name: `Unselect ${first.subject.label}` }),
        ).toBeInTheDocument();
    });

    it("disables the choices while a re-ask is in flight", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                pending
                result={clarification}
            />,
        );

        for (const button of screen.getAllByRole("button", { name: /^Select / })) {
            expect(button).toBeDisabled();
        }
        expect(
            screen.getByRole("button", { name: "Ask about the selected candidates" }),
        ).toBeDisabled();
    });

    it("still shows coverage and limitations alongside the choice", () => {
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        expect(screen.getByRole("region", { name: "Coverage" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Limitations" })).toBeInTheDocument();
    });

    /**
     * A clarification with no candidates is a dead end. Saying so beats an
     * empty list, which reads like a loading state.
     */
    it("says so when a clarification offers nothing to choose", () => {
        const empty = {
            ...clarification,
            subject_resolution: { candidates: [], committed: [] },
        };
        render(
            <DeterministicAnswerView
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={empty}
            />,
        );

        expect(screen.getByText(/nothing to choose/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Select / })).toBeNull();
    });

    /**
     * X2. The property is INTRINSIC to the component, not an obligation on the
     * call site.
     *
     * It used to be conditional on the callback, which left every composition
     * free to render a clarification in the normal answer shape by simply not
     * passing one — the same dead end as C3 and R3, reached a third way. Codex
     * found it three times because it was never pinned HERE.
     */
    it("never renders the normal answer shape for a clarification, even with no callback", () => {
        render(<DeterministicAnswerView result={clarification} />);

        // The clarification content is present, under a DECLARATIVE heading:
        // asking "which did you mean?" of a reader who cannot answer is
        // promise-shaped text, and the heading is our chrome, so it adapts.
        expect(screen.getByRole("region", { name: "Subject candidates" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Which subject did you mean?" })).toBeNull();
        for (const candidate of clarification.subject_resolution.candidates) {
            expect(screen.getByText(candidate.subject.label)).toBeInTheDocument();
        }
        // ...it says it cannot act here...
        expect(screen.getByTestId("cannot-choose-here")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Select / })).toBeNull();
        expect(screen.queryByRole("button", { name: /^Ask about (the selected|\d)/ })).toBeNull();
        // ...and the answer shape is absent.
        expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Remaining work" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Subjects" })).toBeNull();
    });
});
