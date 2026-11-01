import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import type { AssistantOutcome, ChatSnapshot, ChatSource } from "@/render/source";
import {
    assistantTurn,
    fakeFeedback,
    feedbackEntry,
    hostSource,
    snapshotOf,
    userTurn,
} from "@/test/fixtures/host-source";
import { mockScenarios } from "@/test/fixtures/investigations";

/**
 * CHAOS-12387: feedback on an answer, driven by a fake host. The cases follow web's `AskDevFeedback`
 * and its test. Answers are the pinned ACR examples; a value press only reaches the store, which
 * owns the clear.
 */

const RESULT = shapesExample as unknown as InvestigationResult;
const R1 = RESULT.result_id;

function outcomeSnapshot(outcome: AssistantOutcome): ChatSnapshot {
    return snapshotOf(userTurn(0, "Is Ask Dev ready?"), assistantTurn(1, outcome));
}

function answered(result: InvestigationResult = RESULT): ChatSnapshot {
    return outcomeSnapshot({ kind: "answered", result });
}

function scenario(id: string): InvestigationResult {
    return structuredClone(mockScenarios().find((entry) => entry.id === id)!.result);
}

function setup(
    feedback: ReturnType<typeof fakeFeedback> | undefined,
    snapshot: ChatSnapshot = answered(),
) {
    const extra: Pick<ChatSource, "feedback"> = feedback === undefined ? {} : { feedback };
    return render(<AskDevChat source={hostSource(snapshot, extra)} />);
}

const region = () => screen.getByRole("group", { name: "Feedback on this answer" });

const choice = (question: "Correct?" | "Useful?", value: "Yes" | "No") =>
    within(within(region()).getByRole("group", { name: question })).getByRole("button", {
        name: value,
    });

describe("Feedback: the controls", () => {
    it("asks both questions under an answer, in named groups, with web's test ids", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry() }));
        expect(region()).toHaveAttribute("data-testid", "ask-dev-feedback");
        expect(region()).toHaveAttribute("data-state", "ready");
        expect(region()).toHaveAttribute("aria-busy", "false");
        expect(within(region()).getByTestId("ask-dev-feedback-correct")).toHaveAccessibleName(
            "Correct?",
        );
        expect(within(region()).getByTestId("ask-dev-feedback-useful")).toHaveAccessibleName(
            "Useful?",
        );
        for (const question of ["correct", "useful"] as const) {
            for (const value of ["yes", "no"] as const) {
                const button = screen.getByTestId(`ask-dev-feedback-${question}-${value}`);
                expect(button).toHaveAttribute("aria-pressed", "false");
                expect(button).toBeEnabled();
            }
        }
        expect(choice("Correct?", "Yes")).toHaveTextContent("Yes");
        expect(choice("Correct?", "No")).toHaveTextContent("No");
    });

    it("shows the chosen value of each question, and only that one", () => {
        setup(
            fakeFeedback({
                [R1]: feedbackEntry({ desired: { correct: "yes", useful: "no" } }),
            }),
        );
        expect(choice("Correct?", "Yes")).toHaveAttribute("aria-pressed", "true");
        expect(choice("Correct?", "No")).toHaveAttribute("aria-pressed", "false");
        expect(choice("Useful?", "Yes")).toHaveAttribute("aria-pressed", "false");
        expect(choice("Useful?", "No")).toHaveAttribute("aria-pressed", "true");
        expect(choice("Correct?", "Yes").querySelector("svg")).not.toBeNull();
        expect(choice("Correct?", "No").querySelector("svg")).toBeNull();
    });

    it("a press reaches the store once, with the result, the question and the value", async () => {
        const user = userEvent.setup();
        const feedback = fakeFeedback({ [R1]: feedbackEntry() });
        setup(feedback);
        await user.click(choice("Useful?", "No"));
        expect(feedback.choose).toHaveBeenCalledExactlyOnceWith(R1, "useful", "no");
    });

    it("pressing the chosen value sends that value: the store clears it", async () => {
        const user = userEvent.setup();
        const feedback = fakeFeedback({
            [R1]: feedbackEntry({ desired: { correct: "yes", useful: "unset" } }),
        });
        setup(feedback);
        await user.click(choice("Correct?", "Yes"));
        expect(feedback.choose).toHaveBeenCalledExactlyOnceWith(R1, "correct", "yes");
    });

    it("draws the controls disabled and busy while the first read is out", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry({ state: "loading" }) }));
        expect(region()).toHaveAttribute("data-state", "loading");
        expect(region()).toHaveAttribute("aria-busy", "true");
        expect(choice("Correct?", "Yes")).toBeDisabled();
        expect(choice("Useful?", "No")).toBeDisabled();
    });

    it("is busy, and keeps working, while a write is out", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry({ saving: true }) }));
        expect(region()).toHaveAttribute("aria-busy", "true");
        expect(choice("Correct?", "Yes")).toBeEnabled();
    });

    it("a failed read keeps the controls disabled, with Try again (a GET)", async () => {
        const user = userEvent.setup();
        const feedback = fakeFeedback({ [R1]: feedbackEntry({ state: "read_failed" }) });
        setup(feedback);
        const line = screen.getByTestId("ask-dev-feedback-read-failed");
        expect(line).toHaveTextContent("Feedback could not be read.");
        expect(line).toHaveAttribute("role", "status");
        expect(choice("Correct?", "Yes")).toBeDisabled();
        const retry = screen.getByTestId("ask-dev-feedback-retry");
        expect(retry).toHaveTextContent("Try again");
        await user.click(retry);
        expect(feedback.retryRead).toHaveBeenCalledExactlyOnceWith(R1);
        expect(feedback.choose).not.toHaveBeenCalled();
    });

    it("says nothing of a read or a save while neither failed", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry() }));
        expect(screen.queryByTestId("ask-dev-feedback-read-failed")).toBeNull();
        expect(screen.queryByTestId("ask-dev-feedback-retry")).toBeNull();
        expect(screen.queryByTestId("ask-dev-feedback-not-saved")).toBeNull();
    });

    it("says a choice was not saved", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry({ notSaved: true }) }));
        const note = screen.getByTestId("ask-dev-feedback-not-saved");
        expect(note).toHaveTextContent("Feedback was not saved.");
        expect(note).toHaveAttribute("role", "status");
    });

    it("follows the store as an entry changes", () => {
        const feedback = fakeFeedback({ [R1]: feedbackEntry({ state: "loading" }) });
        setup(feedback);
        expect(choice("Correct?", "Yes")).toBeDisabled();
        feedback.setEntry(R1, feedbackEntry({ desired: { correct: "yes", useful: "unset" } }));
        expect(choice("Correct?", "Yes")).toBeEnabled();
        expect(choice("Correct?", "Yes")).toHaveAttribute("aria-pressed", "true");
    });
});

describe("Feedback: reading an entry", () => {
    it("ensures once when the store is ready and has no entry", () => {
        const feedback = fakeFeedback();
        setup(feedback);
        expect(feedback.ensure).toHaveBeenCalledExactlyOnceWith(R1);
        expect(screen.queryByTestId("ask-dev-feedback")).toBeNull();
    });

    it("waits for the store to be ready", () => {
        const feedback = fakeFeedback({}, false);
        setup(feedback);
        expect(feedback.ensure).not.toHaveBeenCalled();
        feedback.setReady(true);
        expect(feedback.ensure).toHaveBeenCalledExactlyOnceWith(R1);
    });

    it("does not read a result the store already has", () => {
        const feedback = fakeFeedback({ [R1]: feedbackEntry() });
        setup(feedback);
        expect(feedback.ensure).not.toHaveBeenCalled();
    });

    it("hides the controls on an unavailable entry", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry({ state: "unavailable" }) }));
        expect(screen.queryByTestId("ask-dev-feedback")).toBeNull();
    });

    it("unsubscribes when it goes away", () => {
        const feedback = fakeFeedback({ [R1]: feedbackEntry() });
        const view = setup(feedback);
        expect(feedback.listeners.size).toBeGreaterThan(0);
        view.unmount();
        expect(feedback.listeners.size).toBe(0);
    });
});

describe("Feedback: which turns show it", () => {
    it("renders nothing without a feedback source", () => {
        setup(undefined);
        expect(screen.queryByTestId("ask-dev-feedback")).toBeNull();
    });

    it.each([
        ["complete", shapesExample],
        ["the canonical answer", canonicalResult],
    ])("shows on %s", (_name, result) => {
        const answer = result as unknown as InvestigationResult;
        setup(fakeFeedback({ [answer.result_id]: feedbackEntry() }), answered(answer));
        expect(region()).toBeInTheDocument();
    });

    it.each(["clarification", "no-match"])("asks nothing on a non-answer: %s", (id) => {
        const result = scenario(id);
        const feedback = fakeFeedback({ [result.result_id]: feedbackEntry() });
        setup(feedback, answered(result));
        expect(screen.queryByTestId("ask-dev-feedback")).toBeNull();
        expect(feedback.ensure).not.toHaveBeenCalled();
    });

    it.each([
        ["a pending turn", { kind: "pending" }],
        ["a status turn", { kind: "status", status: { kind: "stalled" }, retry: false }],
    ] as const)("asks nothing on %s", (_name, outcome) => {
        const feedback = fakeFeedback({ [R1]: feedbackEntry() });
        setup(feedback, outcomeSnapshot(outcome));
        expect(screen.queryByTestId("ask-dev-feedback")).toBeNull();
        expect(feedback.ensure).not.toHaveBeenCalled();
    });

    it("asks on an earlier answer too: a frozen turn keeps its feedback", () => {
        const earlier = canonicalResult as unknown as InvestigationResult;
        const snapshot = snapshotOf(
            userTurn(0, "First?"),
            assistantTurn(1, { kind: "answered", result: earlier }),
            userTurn(2, "Second?"),
            assistantTurn(3, { kind: "answered", result: RESULT }),
        );
        setup(
            fakeFeedback({
                [earlier.result_id]: feedbackEntry(),
                [R1]: feedbackEntry(),
            }),
            snapshot,
        );
        expect(screen.getAllByTestId("ask-dev-feedback")).toHaveLength(2);
    });

    it("sits inside the answer's own turn, after the answer", () => {
        setup(fakeFeedback({ [R1]: feedbackEntry() }));
        const answer = screen.getByTestId("answer-panel");
        expect(
            answer.compareDocumentPosition(region()) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(region().closest(".chat__turn--assistant")).toBe(
            answer.closest(".chat__turn--assistant"),
        );
    });

    it("shows on a withheld result, by the same result id", async () => {
        const user = userEvent.setup();
        const person: InvestigationResult = {
            ...RESULT,
            cohort: { ...RESULT.cohort!, kind: "person" },
        };
        const feedback = fakeFeedback({ [R1]: feedbackEntry() });
        setup(feedback, answered(person));
        expect(screen.getByTestId("ranking-withheld-notice")).toBeInTheDocument();
        await user.click(choice("Correct?", "Yes"));
        expect(feedback.choose).toHaveBeenCalledExactlyOnceWith(R1, "correct", "yes");
    });
});
