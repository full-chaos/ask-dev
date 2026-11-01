import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat } from "@/components/chat/AskDevChat";
import type { InvestigationResult } from "@/lib/contracts";
import type { AssistantOutcome, ChatProgress, ChatTurn } from "@/render/source";
import { assistantTurn, hostSource, snapshotOf, userTurn } from "@/test/fixtures/host-source";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * CHAOS-12406: what a host needs of one render. Each case runs through the seam, with a fake host
 * source, because web drives this render from its own store. Results come from the fixtures.
 */
function scenario(id: string): InvestigationResult {
    const found = mockScenarios().find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`no scenario ${id}`);
    return found.result;
}

const clarification = scenario("clarification");
const answered = scenario("complete");

const question = "Which project is at risk?";

describe("a question ACR did not record", () => {
    const NOT_RECORDED = "Question not recorded";

    it("shows the words in the bubble, muted and italic, under web's test id", () => {
        const source = hostSource(
            snapshotOf(userTurn(0, null), assistantTurn(1, { kind: "answered", result: answered })),
        );
        render(<AskDevChat source={source} />);

        const note = screen.getByTestId("ask-dev-turn-question-not-recorded");
        expect(note).toHaveTextContent(NOT_RECORDED);
        expect(note).toHaveClass("chat__bubble--not-recorded");
    });

    it("shows a recorded question as it was, with no note", () => {
        const source = hostSource(
            snapshotOf(
                userTurn(0, question),
                assistantTurn(1, { kind: "answered", result: answered }),
            ),
        );
        render(<AskDevChat source={source} />);

        expect(screen.queryByTestId("ask-dev-turn-question-not-recorded")).toBeNull();
        expect(screen.getByText(question)).toHaveClass("chat__bubble");
    });

    it("names the turn in the rail with the words, unquoted", () => {
        const source = hostSource(
            snapshotOf(userTurn(0, null), assistantTurn(1, { kind: "answered", result: answered })),
        );
        render(<AskDevChat source={source} />);

        const rail = screen.getByRole("complementary", { name: "This conversation" });
        const item = within(rail).getByRole("button", { name: /Show the question/ });
        expect(item).toHaveTextContent(NOT_RECORDED);
        expect(item.textContent).not.toContain("“");
    });

    it("still renders the turn's answer", () => {
        const source = hostSource(
            snapshotOf(userTurn(0, null), assistantTurn(1, { kind: "answered", result: answered })),
        );
        render(<AskDevChat source={source} />);

        expect(screen.getByRole("article", { name: "Answer" })).toBeInTheDocument();
    });

    describe("offers no choice and no re-ask (web's rule)", () => {
        const clarifying = (user: ChatTurn) =>
            hostSource(
                snapshotOf(user, assistantTurn(1, { kind: "answered", result: clarification })),
            );

        it("a recorded clarification opens the popup: the control", () => {
            render(<AskDevChat source={clarifying(userTurn(0, question))} />);
            expect(screen.getByRole("dialog")).toBeInTheDocument();
        });

        it.each<[string, AssistantOutcome]>([
            ["a retryable status", { kind: "status", status: { kind: "stalled" }, retry: true }],
            [
                "a retryable status of a kind that may retry",
                { kind: "status", status: { kind: "failed" }, retry: true },
            ],
            [
                "a retryable failure",
                {
                    kind: "failed",
                    failure: { code: "acr_unreachable", message: "No.", retryable: true },
                },
            ],
        ])("offers no Retry on %s, even with a retry question", (_name, outcome) => {
            render(
                <AskDevChat
                    source={hostSource(
                        snapshotOf(userTurn(0, null), assistantTurn(1, outcome, "A guess?")),
                    )}
                />,
            );

            expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        });

        it("a null-question clarification shows no popup and no confirm", () => {
            render(<AskDevChat source={clarifying(userTurn(0, null))} />);

            expect(screen.queryByRole("dialog")).toBeNull();
            expect(screen.queryByRole("button", { name: /^Select / })).toBeNull();
            expect(screen.queryByRole("button", { name: /^Ask about/ })).toBeNull();
            // The turn still reads: its options are a read-only echo.
            expect(screen.getByRole("article", { name: "Answer" })).toBeInTheDocument();
        });

        it("a null-question turn's options read as a frozen echo, on both axes", () => {
            const structured = structureMockScenarios().find((s) => s.id === "structure-kind");
            const source = hostSource(
                snapshotOf(
                    userTurn(0, null),
                    assistantTurn(1, { kind: "answered", result: structured!.result }),
                ),
            );
            render(<AskDevChat source={source} />);
            expect(screen.getByTestId("frozen-offers-disclosure")).toBeInTheDocument();
        });

        it("a null-question subject clarification reads as a frozen echo too", () => {
            render(<AskDevChat source={clarifying(userTurn(0, null))} />);
            expect(screen.getByTestId("frozen-offers-disclosure")).toBeInTheDocument();
        });

        it("holds for every turn under a silent null-question user turn: a batch", () => {
            const source = hostSource(
                snapshotOf(
                    { ...userTurn(0, null), showBubble: false } as ChatTurn,
                    assistantTurn(1, { kind: "answered", result: answered }),
                    assistantTurn(2, { kind: "answered", result: clarification }),
                ),
            );
            render(<AskDevChat source={source} />);

            expect(screen.queryByRole("dialog")).toBeNull();
        });

        it("reads the user turn of that answer, not an older one", () => {
            const source = hostSource(
                snapshotOf(
                    userTurn(0, null),
                    assistantTurn(1, { kind: "answered", result: answered }),
                    userTurn(2, question),
                    assistantTurn(3, { kind: "answered", result: clarification }),
                ),
            );
            render(<AskDevChat source={source} />);

            expect(screen.getByRole("dialog")).toBeInTheDocument();
        });

        const refused = (user: ChatTurn) =>
            hostSource(
                snapshotOf(
                    user,
                    assistantTurn(
                        1,
                        {
                            kind: "failed",
                            failure: {
                                code: "acr_rejected_request",
                                httpStatus: 413,
                                message: "Too large.",
                                narrowerContinuation: { axis: "result_count" },
                                retryable: false,
                            },
                        },
                        question,
                    ),
                ),
            );

        it("a recorded refusal offers the re-ask: the control", () => {
            render(<AskDevChat source={refused(userTurn(0, question))} />);
            expect(screen.getByTestId("ask-dev-refusal-reask")).toBeInTheDocument();
        });

        it("a null-question refusal offers no re-ask, whatever root the host set", () => {
            render(<AskDevChat source={refused(userTurn(0, null))} />);

            expect(screen.getByTestId("ask-dev-refusal")).toBeInTheDocument();
            expect(screen.queryByTestId("ask-dev-refusal-reask")).toBeNull();
        });
    });
});

function progressTurn(progress: ChatProgress) {
    return hostSource(
        snapshotOf(userTurn(0, question), assistantTurn(1, { kind: "pending", progress })),
    );
}

const statusLine = () => within(screen.getByTestId("chat-progress")).getByRole("status");

describe("a run that is canceling", () => {
    const startedAt = "2026-10-30T12:00:00.000Z";

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
        vi.setSystemTime(new Date("2026-10-30T12:01:05.000Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(["running", "recovering", "observing", "restoring"] as const)(
        "shows Canceling… alone on a %s turn",
        (phase) => {
            render(<AskDevChat source={progressTurn({ phase, stop: "canceling", startedAt })} />);

            expect(statusLine().textContent).toBe("Canceling…");
            expect(screen.queryByTestId("chat-progress-stop")).toBeNull();
        },
    );

    it("keeps the elapsed line and drops the checklist: web's rule", () => {
        render(
            <AskDevChat
                source={progressTurn({
                    phase: "running",
                    stage: "reading_facts",
                    stop: "canceling",
                    startedAt,
                })}
            />,
        );

        expect(screen.queryByRole("list", { name: "Investigation steps" })).toBeNull();
        expect(screen.getByTestId("chat-elapsed").textContent).toBe("Elapsed 1:05");
    });

    it("the other stop states keep the phase line and the checklist", () => {
        render(
            <AskDevChat
                source={progressTurn({ phase: "running", stop: "requested", startedAt })}
            />,
        );

        expect(statusLine().textContent).toBe("Investigating…");
        expect(screen.getByTestId("chat-progress-stop")).toHaveTextContent("Stopping…");
        expect(screen.getByRole("list", { name: "Investigation steps" })).toBeInTheDocument();
    });
});

describe("a batch a host runs in sequence", () => {
    const WAITING = "Waiting for the question before it to finish.";
    const startedAt = "2026-10-30T12:00:00.000Z";

    it("a queued item says its place and that it waits", () => {
        render(
            <AskDevChat
                source={progressTurn({
                    phase: "queued",
                    batch: { position: 2, total: 3 },
                    startedAt,
                })}
            />,
        );

        expect(screen.getByTestId("chat-progress-batch")).toHaveTextContent(/^Question 2 of 3$/u);
        expect(statusLine().textContent).toBe(WAITING);
    });

    it("a queued item has no checklist and no clock: nothing of it has run", () => {
        render(
            <AskDevChat
                source={progressTurn({
                    phase: "queued",
                    batch: { position: 2, total: 3 },
                    startedAt,
                })}
            />,
        );

        expect(screen.queryByRole("list", { name: "Investigation steps" })).toBeNull();
        expect(screen.queryByTestId("chat-elapsed")).toBeNull();
    });

    it("a running item says its place too, and runs as any other", () => {
        render(
            <AskDevChat
                source={progressTurn({ phase: "running", batch: { position: 1, total: 3 } })}
            />,
        );

        expect(screen.getByTestId("chat-progress-batch")).toHaveTextContent(/^Question 1 of 3$/u);
        expect(statusLine().textContent).toBe("Investigating…");
        expect(screen.getByRole("list", { name: "Investigation steps" })).toBeInTheDocument();
    });

    it("a total of one shows no line", () => {
        render(
            <AskDevChat
                source={progressTurn({ phase: "running", batch: { position: 1, total: 1 } })}
            />,
        );

        expect(screen.queryByTestId("chat-progress-batch")).toBeNull();
    });

    it("no batch shows no line", () => {
        render(<AskDevChat source={progressTurn({ phase: "running" })} />);

        expect(screen.queryByTestId("chat-progress-batch")).toBeNull();
    });

    it("a queued item holds the composer, so a batch never stalls silently", () => {
        render(
            <AskDevChat
                source={progressTurn({ phase: "queued", batch: { position: 3, total: 3 } })}
            />,
        );

        expect(screen.getByRole("textbox", { name: "Ask a question" })).toBeDisabled();
    });

    it("each item of one batch shows on its own pending turn", () => {
        const source = hostSource(
            snapshotOf(
                { ...userTurn(0, question), showBubble: false } as ChatTurn,
                assistantTurn(1, {
                    kind: "pending",
                    progress: { phase: "running", batch: { position: 1, total: 2 } },
                }),
                assistantTurn(2, {
                    kind: "pending",
                    progress: { phase: "queued", batch: { position: 2, total: 2 } },
                }),
            ),
        );
        render(<AskDevChat source={source} />);

        expect(
            screen.getAllByTestId("chat-progress-batch").map((line) => line.textContent),
        ).toEqual(["Question 1 of 2", "Question 2 of 2"]);
        expect(screen.getByText(WAITING)).toBeInTheDocument();
    });
});

describe("a host's turn stays usable", () => {
    it("the composer still takes a new question after a null-question answer", async () => {
        const user = userEvent.setup();
        const source = hostSource(
            snapshotOf(userTurn(0, null), assistantTurn(1, { kind: "answered", result: answered })),
        );
        render(<AskDevChat source={source} />);

        await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "Next?{Enter}");

        await waitFor(() => expect(source.ask).toHaveBeenCalledTimes(1));
    });
});
