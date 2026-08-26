import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { choiceDisposition, subjectForReceipt } from "@/lib/clarification";
import type { InvestigationResult, SubjectRef } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;

const chosen: SubjectRef = clarification.subject_resolution.candidates[0]!.subject;

describe("subjectForReceipt", () => {
    it("resolves a receipt to the subject the issuing result named", () => {
        const candidate = clarification.subject_resolution.candidates[1]!;
        expect(subjectForReceipt(clarification, candidate.receipt_id)).toEqual(candidate.subject);
    });

    it("returns nothing for a receipt this result never issued", () => {
        expect(subjectForReceipt(clarification, "receipt_not_from_here")).toBeUndefined();
    });
});

describe("choiceDisposition", () => {
    it("reports applied when the chosen subject is committed", () => {
        const applied: InvestigationResult = {
            ...answered,
            subject_resolution: { candidates: [], committed: [chosen] },
        };
        expect(choiceDisposition(applied, chosen)).toEqual({ applied: true });
    });

    it("compares by canonical id, not by label", () => {
        const relabelled: InvestigationResult = {
            ...answered,
            subject_resolution: {
                candidates: [],
                committed: [{ ...chosen, label: "A Different Display Name" }],
            },
        };
        expect(choiceDisposition(relabelled, chosen).applied).toBe(true);
    });

    it("does not treat a different subject of the same kind as the chosen one", () => {
        const other: InvestigationResult = {
            ...answered,
            subject_resolution: {
                candidates: [],
                committed: [{ ...chosen, canonical_id: "project_something_else" }],
            },
        };
        expect(choiceDisposition(other, chosen)).toEqual({ applied: false, answered: true });
    });
});

/**
 * The two shapes a dishonoured choice takes. Both must be unrepresentable as
 * normal output — the first would read as an answer about the chosen subject,
 * the second as an ordinary second clarification.
 */
describe("a dishonoured choice is never presented as normal", () => {
    it("SHAPE 1 — an answer about a different subject says so, loudly", () => {
        const aboutSomethingElse: InvestigationResult = {
            ...answered,
            subject_resolution: {
                candidates: [],
                committed: [{ ...chosen, canonical_id: "project_something_else" }],
            },
        };

        render(
            <DeterministicAnswerView
                chosenSubject={chosen}
                onConfirmCandidates={vi.fn()}
                result={aboutSomethingElse}
            />,
        );

        const notice = screen.getByRole("alert", { name: "Choice not applied" });
        expect(notice).toBeInTheDocument();
        expect(notice.textContent).toContain(`This answer is NOT about ${chosen.label}`);
        // The answer still renders — this is detection, not suppression.
        expect(screen.getByRole("region", { name: "Answer" })).toBeInTheDocument();
    });

    /**
     * The loop. A second clarification may offer the SAME candidates, so
     * without this a tester can choose, be asked again, choose again, and never
     * learn that their choice is being discarded every time.
     */
    it("SHAPE 2 — a second clarification is not presented as an ordinary one", () => {
        render(
            <DeterministicAnswerView
                chosenSubject={chosen}
                onConfirmCandidates={vi.fn()}
                result={clarification}
            />,
        );

        const notice = screen.getByRole("alert", { name: "Choice not applied" });
        expect(notice.textContent).toContain(`ACR did not commit ${chosen.label}`);
        expect(notice.textContent).toContain("Choosing the same candidate is likely to repeat");
        // The choice UI is still offered; the tester is simply told the truth
        // about what happened to the last one.
        expect(
            screen.getByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
    });

    it("stays silent when the choice WAS applied", () => {
        const applied: InvestigationResult = {
            ...answered,
            subject_resolution: { candidates: [], committed: [chosen] },
        };

        render(
            <DeterministicAnswerView
                chosenSubject={chosen}
                onConfirmCandidates={vi.fn()}
                result={applied}
            />,
        );

        expect(screen.queryByRole("alert", { name: "Choice not applied" })).toBeNull();
    });

    it("stays silent when no choice was made at all", () => {
        render(<DeterministicAnswerView onConfirmCandidates={vi.fn()} result={answered} />);

        expect(screen.queryByRole("alert", { name: "Choice not applied" })).toBeNull();
    });

    /** Detection, not repair: the notice offers no way to retry. */
    it("offers no retry", () => {
        render(
            <DeterministicAnswerView
                chosenSubject={chosen}
                onConfirmCandidates={vi.fn()}
                result={answered}
            />,
        );

        const notice = screen.getByRole("alert", { name: "Choice not applied" });
        expect(notice.querySelector("button")).toBeNull();
    });
});
