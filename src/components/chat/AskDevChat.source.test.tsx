import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskDevChat, withheldTurn } from "@/components/chat/AskDevChat";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import type { InvestigationResult, InvestigationResultV1 } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import type {
    AssistantOutcome,
    ChatProgress,
    ChatSnapshot,
    ChatSource,
    ChatStatus,
    ChatTurn,
    NotRunReason,
    StoppedReason,
} from "@/render/source";
import { createStandaloneSource } from "@/render/standalone-source";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * CHAOS-12382: `AskDevChat` renders from a source. A fake host source (snapshots this file
 * controls) drives every outcome only a host produces; the standalone source keeps today's markup.
 *
 * The status and progress words are written out here, not read from `chat-copy.ts`: they are web's
 * words and web's tests pin them, so a change to the table must fail here.
 */

const ASKED_AT = "2026-10-30T12:00:00.000Z";

function userTurn(id: number, question: string): ChatTurn {
    return { role: "user", id, question, createdAt: ASKED_AT, showBubble: true };
}

function assistantTurn(id: number, outcome: AssistantOutcome, question?: string): ChatTurn {
    return {
        role: "assistant",
        id,
        createdAt: ASKED_AT,
        outcome,
        chosenSubject: undefined,
        submittedStructureBatch: undefined,
        submittedCandidateReceiptIds: undefined,
        submittedStructureCandidateReceiptIds: undefined,
        retryQuestion: question,
        rootQuestion: question,
    };
}

type HostSource = Omit<ChatSource, "ask" | "askBatch" | "retry" | "newConversation"> & {
    readonly publish: (next: ChatSnapshot) => void;
    readonly ask: ReturnType<typeof vi.fn<ChatSource["ask"]>>;
    readonly askBatch: ReturnType<typeof vi.fn<ChatSource["askBatch"]>>;
    readonly retry: ReturnType<typeof vi.fn<ChatSource["retry"]>>;
    readonly newConversation: ReturnType<typeof vi.fn<ChatSource["newConversation"]>>;
};

function hostSource(
    initial: ChatSnapshot,
    extra: Pick<ChatSource, "stop" | "slots" | "reloadTurn"> = {},
): HostSource {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: () => snapshot,
        ask: vi.fn<ChatSource["ask"]>(() => Promise.resolve(true)),
        askBatch: vi.fn<ChatSource["askBatch"]>(),
        retry: vi.fn<ChatSource["retry"]>(() => Promise.resolve(true)),
        newConversation: vi.fn<ChatSource["newConversation"]>(),
        ...extra,
        publish(next) {
            snapshot = next;
            for (const listener of listeners) listener();
        },
    };
}

function snapshotOf(...turns: readonly ChatTurn[]): ChatSnapshot {
    return { turns, stoppable: false };
}

function statusSnapshot(status: ChatStatus, retry = false): ChatSnapshot {
    return snapshotOf(
        userTurn(0, "Is Ask Dev ready?"),
        assistantTurn(1, { kind: "status", status, retry }, "Is Ask Dev ready?"),
    );
}

function progressSnapshot(progress: ChatProgress): ChatSnapshot {
    return snapshotOf(
        userTurn(0, "Is Ask Dev ready?"),
        assistantTurn(1, { kind: "pending", progress }, "Is Ask Dev ready?"),
    );
}

function stageStates(): readonly (readonly [string | undefined, string | undefined])[] {
    return [...document.querySelectorAll<HTMLElement>(".chat__stage")].map((row) => [
        row.dataset.stage,
        row.dataset.state,
    ]);
}

type StatusOf<K extends ChatStatus["kind"]> = Extract<ChatStatus, { kind: K }>;

/**
 * Exhaustive by type: a status kind, a deadline, a limit or a reason with no row here fails
 * `pnpm typecheck`, so no outcome can reach the render without its words pinned.
 */
const DEADLINE_WORDS: Record<StatusOf<"deadline">["which"], string> = {
    model: "A model step ran out of time, so the investigation stopped before an answer. Ask again, or ask a narrower question.",
    request:
        "The investigation ran out of time before an answer. Ask again, or ask a narrower question.",
    admission: "Ask Dev did not start the investigation in time. Ask again.",
    budget_exhausted: "Ask Dev ran out of time before the question could start. Ask again.",
};

const LIMITED_WORDS: Record<StatusOf<"limited">["which"], string> = {
    principal:
        "You already have as many questions running as Ask Dev allows. Wait for one to finish, then try again.",
    org: "Your organization already has as many questions running as Ask Dev allows. Try again shortly.",
    concurrency: "Too many questions are running at once. Try again shortly.",
    allowance: "Your organization has used this month's Ask Dev allowance.",
};

const NOT_RUN_WORDS: Record<NotRunReason, string> = {
    access_denied:
        "Ask Dev is not available in this session. Sign in again with your own account, or ask an admin to add you to this organization.",
    no_repository:
        "No repository is available to you here. Connect a repository, or ask an admin for access to one.",
    not_entitled: "Ask Dev is not available for this organization.",
    repo_forbidden:
        "A repository this question needs is not available to you. If it was connected just now, wait for its first sync.",
    budget_refusal: "This question needs more than one answer can hold. Ask a narrower question.",
    rate_limited: "Too many questions in a short time. Wait a moment, then ask again.",
};

const STOPPED_WORDS: Record<StoppedReason, string> = {
    rate_limited: "This question was rate limited after it started. Wait a moment, then ask again.",
    interpretation_rejected:
        "Dev could not accept an interpretation of your question. Try rephrasing it.",
    synthesis_rejected: "Dev could not accept a generated answer. Try rephrasing your question.",
};

const PLAIN_WORDS: Record<
    Exclude<ChatStatus["kind"], "deadline" | "limited" | "not_run" | "stopped" | "failed">,
    string
> = {
    stream_unavailable:
        "Ask Dev cannot stream answers on this deployment right now. Contact your administrator.",
    mismatch: "This question could not be sent again as it was first sent. Ask again.",
    unsaved: "The answer was shown but not saved — ask again",
    abandoned: "An earlier run of this question ended without an answer. Ask again.",
    interrupted: "Interrupted — ask again",
    stalled: "The answer stopped arriving. Ask again.",
    canceled: "Canceled. If the answer had already finished, it is kept.",
    halted: "Stopped or interrupted. Ask again.",
    thread_closed:
        "This conversation has ended (deleted, expired or full). Ask again to start a new one.",
    connect:
        "Ask Dev needs your permission to answer from your data. Connect Ask Dev, then ask again.",
    unavailable: "This answer is not available to you now.",
    restore_failed: "This answer could not be loaded.",
    unconfirmed: "The current state could not be confirmed. Check back later.",
};

function rows<K extends string>(
    words: Record<K, string>,
    status: (key: K) => ChatStatus,
): readonly (readonly [ChatStatus, boolean, string])[] {
    return (Object.entries(words) as [K, string][]).map(([key, text]) => [
        status(key),
        false,
        text,
    ]);
}

/** Every status with `retry` false, and its exact words. `failed` depends on `retry`: see below. */
const STATUS_WORDS: readonly (readonly [ChatStatus, boolean, string])[] = [
    ...rows(DEADLINE_WORDS, (which) => ({ kind: "deadline", which })),
    ...rows(LIMITED_WORDS, (which) => ({ kind: "limited", which })),
    ...rows(NOT_RUN_WORDS, (reason) => ({ kind: "not_run", reason })),
    ...rows(STOPPED_WORDS, (reason) => ({ kind: "stopped", reason })),
    ...rows(PLAIN_WORDS, (kind) => ({ kind })),
    [{ kind: "failed" }, false, "The investigation did not finish. Ask again."],
    [{ kind: "failed" }, true, "The question could not be sent. Try again."],
];

describe("AskDevChat with a host source: pending progress", () => {
    it("renders the five stages in order, with each one's state", () => {
        render(
            <AskDevChat
                source={hostSource(
                    progressSnapshot({
                        stages: [
                            { stage: "interpreting", state: "started" },
                            { stage: "interpreting", state: "completed" },
                            { stage: "resolving_subjects", state: "started" },
                        ],
                    }),
                )}
            />,
        );
        expect(stageStates()).toEqual([
            ["interpreting", "done"],
            ["resolving_subjects", "active"],
            ["reading_facts", "pending"],
            ["synthesizing", "pending"],
            ["validating", "pending"],
        ]);
        expect(within(screen.getByTestId("chat-progress")).getByRole("status")).toHaveTextContent(
            "Investigating…",
        );
        expect(document.querySelector('[aria-current="step"]')).toHaveTextContent(
            "Finding what the question is about",
        );
    });

    it("takes the current stage from `stage` alone, and marks a stage ACR skipped", () => {
        render(
            <AskDevChat
                source={hostSource(
                    progressSnapshot({
                        stage: "synthesizing",
                        stages: [{ stage: "interpreting", state: "started" }],
                    }),
                )}
            />,
        );
        expect(stageStates()).toEqual([
            ["interpreting", "done"],
            ["resolving_subjects", "skipped"],
            ["reading_facts", "skipped"],
            ["synthesizing", "active"],
            ["validating", "pending"],
        ]);
    });

    it("keeps a completed stage done when a late started event repeats it", () => {
        render(
            <AskDevChat
                source={hostSource(
                    progressSnapshot({
                        stages: [
                            { stage: "interpreting", state: "completed" },
                            { stage: "interpreting", state: "started" },
                        ],
                    }),
                )}
            />,
        );
        expect(stageStates()[0]).toEqual(["interpreting", "done"]);
    });

    it("shows the checklist on a running turn, even before a stage is named", () => {
        render(<AskDevChat source={hostSource(progressSnapshot({}))} />);
        expect(stageStates()).toHaveLength(5);
    });

    it.each(["recovering", "observing", "restoring"] as const)(
        "claims no stage on a %s turn that names none, and keeps the ones it names",
        (phase) => {
            const { unmount } = render(
                <AskDevChat source={hostSource(progressSnapshot({ phase }))} />,
            );
            expect(document.querySelector(".chat__stages")).toBeNull();
            unmount();

            const stage = render(
                <AskDevChat
                    source={hostSource(progressSnapshot({ phase, stage: "reading_facts" }))}
                />,
            );
            expect(stageStates()[2]).toEqual(["reading_facts", "active"]);
            stage.unmount();

            render(
                <AskDevChat
                    source={hostSource(
                        progressSnapshot({
                            phase,
                            stages: [{ stage: "interpreting", state: "completed" }],
                        }),
                    )}
                />,
            );
            expect(stageStates()[0]).toEqual(["interpreting", "done"]);
        },
    );

    it.each([
        ["running", "Investigating…"],
        ["recovering", "The connection dropped. Checking whether the answer finished…"],
        [
            "observing",
            "This question was still running when the conversation was loaded. Checking for its answer…",
        ],
        ["restoring", "Loading this answer…"],
    ] as const)("words the %s phase", (phase, words) => {
        render(<AskDevChat source={hostSource(progressSnapshot({ phase }))} />);
        expect(within(screen.getByTestId("chat-progress")).getByRole("status")).toHaveTextContent(
            new RegExp(`^${words}$`),
        );
    });

    it.each([
        ["requested", "Stopping…"],
        ["not_leased", "This run cannot be stopped. It ends on its own."],
    ] as const)("words a stop that is %s", (stop, words) => {
        render(<AskDevChat source={hostSource(progressSnapshot({ stop }))} />);
        expect(screen.getByTestId("chat-progress-stop")).toHaveTextContent(words);
    });

    it("says nothing of a stop that is idle", () => {
        render(<AskDevChat source={hostSource(progressSnapshot({ stop: "idle" }))} />);
        expect(screen.queryByTestId("chat-progress-stop")).toBeNull();
    });

    it("names no last sighting on a pending turn: web has it on unconfirmed only", () => {
        render(
            <AskDevChat
                source={hostSource(
                    progressSnapshot({
                        phase: "running",
                        lastSeenRunningAt: "2026-10-30T12:05:00Z",
                    } as ChatProgress),
                )}
            />,
        );
        expect(screen.getByTestId("chat-progress").textContent).not.toContain("Last seen");
    });

    describe("elapsed", () => {
        const startedAt = "2026-10-30T12:00:00.000Z";

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
            vi.setSystemTime(new Date("2026-10-30T12:01:05.000Z"));
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it.each([
            ["running", { phase: "running" }],
            ["a turn that names no phase", {}],
            ["recovering", { phase: "recovering" }],
            ["observing", { phase: "observing" }],
            ["canceling", { phase: "running", stop: "canceling" }],
            ["canceling a restoring turn", { phase: "restoring", stop: "canceling" }],
        ] as const)("shows on %s", (_name, progress) => {
            render(
                <AskDevChat source={hostSource(progressSnapshot({ ...progress, startedAt }))} />,
            );
            expect(screen.getByTestId("chat-elapsed").textContent).toBe("Elapsed 1:05");
        });

        it("is not shown on a restoring turn", () => {
            render(
                <AskDevChat
                    source={hostSource(progressSnapshot({ phase: "restoring", startedAt }))}
                />,
            );
            expect(screen.queryByTestId("chat-elapsed")).toBeNull();
        });

        it("is not shown without a start, or with one that is not a time", () => {
            const none = render(<AskDevChat source={hostSource(progressSnapshot({}))} />);
            expect(screen.queryByTestId("chat-elapsed")).toBeNull();
            none.unmount();
            render(
                <AskDevChat source={hostSource(progressSnapshot({ startedAt: "not a time" }))} />,
            );
            expect(screen.queryByTestId("chat-elapsed")).toBeNull();
        });

        it("counts once a second, and is not announced each second", () => {
            render(<AskDevChat source={hostSource(progressSnapshot({ startedAt }))} />);
            const line = screen.getByTestId("chat-elapsed");
            expect(line).toHaveAttribute("aria-live", "off");
            act(() => {
                vi.advanceTimersByTime(2_000);
            });
            expect(screen.getByTestId("chat-elapsed-value").textContent).toBe("1:07");
        });

        it("never shows a negative time", () => {
            render(
                <AskDevChat
                    source={hostSource(progressSnapshot({ startedAt: "2026-10-30T13:00:00.000Z" }))}
                />,
            );
            expect(screen.getByTestId("chat-elapsed-value").textContent).toBe("0:00");
        });
    });

    it("holds the composer while a turn is pending, as the standalone path does", () => {
        render(<AskDevChat source={hostSource(progressSnapshot({ phase: "running" }))} />);
        expect(screen.getByPlaceholderText(/Ask about a project/)).toBeDisabled();
    });
});

describe("AskDevChat with a host source: status", () => {
    it.each(STATUS_WORDS)("renders the exact words of %j (retry %s)", (status, retry, words) => {
        render(<AskDevChat source={hostSource(statusSnapshot(status, retry))} />);
        const panel = screen.getByTestId("chat-status");
        expect(panel.dataset.status).toBe(status.kind);
        expect(panel.querySelector(".chat__status-words")?.textContent).toBe(words);
    });

    it("the table reaches every kind, and every word of the sub-tables", () => {
        expect(new Set(STATUS_WORDS.map(([status]) => status.kind)).size).toBe(18);
        expect(STATUS_WORDS).toHaveLength(4 + 4 + 6 + 3 + 13 + 2);
    });

    const RETRYABLE = new Set<ChatStatus["kind"]>(["failed", "limited", "not_run"]);

    it.each(STATUS_WORDS.filter(([status]) => !RETRYABLE.has(status.kind)))(
        "offers no Retry on %j, whatever the source says",
        (status) => {
            render(<AskDevChat source={hostSource(statusSnapshot(status, true))} />);
            expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        },
    );

    it.each(STATUS_WORDS.filter(([status]) => RETRYABLE.has(status.kind)))(
        "offers Retry on %j only when the source says so",
        (status) => {
            const yes = render(<AskDevChat source={hostSource(statusSnapshot(status, true))} />);
            expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
            yes.unmount();
            render(<AskDevChat source={hostSource(statusSnapshot(status, false))} />);
            expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        },
    );

    it.each([
        [{ kind: "failed", reference: "req_abc123" }],
        [{ kind: "mismatch", reference: "req_abc123" }],
    ] as const)("shows the reference of %j in a code element", (status) => {
        render(<AskDevChat source={hostSource(statusSnapshot(status))} />);
        const line = screen.getByTestId("chat-status-reference");
        expect(line.textContent).toBe("Reference: req_abc123");
        expect(line.querySelector("code")?.textContent).toBe("req_abc123");
    });

    it("shows no reference line without a reference", () => {
        render(<AskDevChat source={hostSource(statusSnapshot({ kind: "failed" }))} />);
        expect(screen.queryByTestId("chat-status-reference")).toBeNull();
    });

    it("an unconfirmed turn shows when the run was last seen, in local time", () => {
        const at = "2026-10-30T12:05:00Z";
        render(
            <AskDevChat
                source={hostSource(statusSnapshot({ kind: "unconfirmed", lastSeenRunningAt: at }))}
            />,
        );
        const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
            new Date(at),
        );
        expect(screen.getByTestId("chat-status-last-seen").textContent).toBe(
            `Last seen running at ${time}`,
        );
    });

    it("an unconfirmed turn with no last sighting claims none", () => {
        render(<AskDevChat source={hostSource(statusSnapshot({ kind: "unconfirmed" }))} />);
        expect(screen.queryByTestId("chat-status-last-seen")).toBeNull();
    });

    it("Load again calls reloadTurn with the turn's id, on any turn, and never resends", async () => {
        const user = userEvent.setup();
        const reloadTurn = vi.fn();
        const source = hostSource(
            snapshotOf(
                userTurn(0, "First?"),
                assistantTurn(
                    1,
                    { kind: "status", status: { kind: "restore_failed" }, retry: false },
                    "First?",
                ),
                userTurn(2, "Second?"),
                assistantTurn(3, {
                    kind: "status",
                    status: { kind: "canceled" },
                    retry: false,
                }),
            ),
            { reloadTurn },
        );
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Load again" }));
        expect(reloadTurn).toHaveBeenCalledTimes(1);
        expect(reloadTurn).toHaveBeenCalledWith(1);
        expect(source.ask).not.toHaveBeenCalled();
        expect(source.retry).not.toHaveBeenCalled();
    });

    it("shows no Load again when the source does not offer it", () => {
        render(<AskDevChat source={hostSource(statusSnapshot({ kind: "restore_failed" }))} />);
        expect(screen.queryByRole("button", { name: "Load again" })).toBeNull();
    });

    it("shows no Load again on any other kind, even when the source offers it", () => {
        render(
            <AskDevChat
                source={hostSource(statusSnapshot({ kind: "unavailable" }), {
                    reloadTurn: vi.fn(),
                })}
            />,
        );
        expect(screen.queryByRole("button", { name: "Load again" })).toBeNull();
    });

    it("does not hold the composer: a status is not pending", () => {
        render(<AskDevChat source={hostSource(statusSnapshot({ kind: "stalled" }))} />);
        expect(screen.getByPlaceholderText(/Ask about a project/)).toBeEnabled();
    });

    it("a status Retry reaches source.retry once with the turn's id, and ask never", async () => {
        const user = userEvent.setup();
        const source = hostSource(statusSnapshot({ kind: "limited", which: "org" }, true));
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(source.retry).toHaveBeenCalledTimes(1);
        expect(source.retry).toHaveBeenCalledWith(1, {
            narrowingRoot: undefined,
            selectionEvents: [],
        });
        expect(source.ask).not.toHaveBeenCalled();
    });

    it("a retryable failed Retry reaches source.retry once, and ask never", async () => {
        const user = userEvent.setup();
        const source = hostSource(
            snapshotOf(
                userTurn(0, "Is Ask Dev ready?"),
                assistantTurn(
                    1,
                    {
                        kind: "failed",
                        failure: {
                            code: "acr_unreachable",
                            message: "Ask Dev's server could not be reached.",
                            retryable: true,
                        },
                    },
                    "Is Ask Dev ready?",
                ),
            ),
        );
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(source.retry).toHaveBeenCalledTimes(1);
        expect(source.retry.mock.calls[0]?.[0]).toBe(1);
        expect(source.ask).not.toHaveBeenCalled();
    });

    it("keeps the composer's draft handling: answered clears it, anything else keeps it", async () => {
        const user = userEvent.setup();
        const source = hostSource(statusSnapshot({ kind: "limited", which: "org" }, true));
        source.retry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        render(<AskDevChat source={source} />);
        const composer = screen.getByPlaceholderText(/Ask about a project/);

        await user.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(composer).toHaveValue("Is Ask Dev ready?"));

        await user.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(composer).toHaveValue(""));
        expect(source.retry).toHaveBeenCalledTimes(2);
    });

    it("the ask after a Retry is a new ask", async () => {
        const user = userEvent.setup();
        const source = hostSource(statusSnapshot({ kind: "limited", which: "org" }, true));
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Retry" }));
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Something else");
        await user.click(screen.getByRole("button", { name: "Send" }));
        expect(source.retry).toHaveBeenCalledTimes(1);
        expect(source.ask).toHaveBeenCalledTimes(1);
    });

    it("a Retry the composer refuses leaves nothing for the next ask to resend", async () => {
        const user = userEvent.setup();
        const blank = snapshotOf(
            userTurn(0, "Is Ask Dev ready?"),
            assistantTurn(
                1,
                { kind: "status", status: { kind: "limited", which: "org" }, retry: true },
                "",
            ),
        );
        const source = hostSource(blank);
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(source.retry).not.toHaveBeenCalled();
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Something else");
        await user.click(screen.getByRole("button", { name: "Send" }));
        expect(source.ask).toHaveBeenCalledTimes(1);
        expect(source.retry).not.toHaveBeenCalled();
    });

    it("offers no Retry on a frozen turn, or without a plain question", () => {
        const stalled: AssistantOutcome = {
            kind: "status",
            status: { kind: "failed" },
            retry: true,
        };

        // A newer assistant turn freezes this one.
        const frozen = render(
            <AskDevChat
                source={hostSource(
                    snapshotOf(
                        userTurn(0, "First?"),
                        assistantTurn(1, stalled, "First?"),
                        userTurn(2, "Second?"),
                        assistantTurn(
                            3,
                            { kind: "status", status: { kind: "canceled" }, retry: false },
                            "Second?",
                        ),
                    ),
                )}
            />,
        );
        expect(screen.getAllByTestId("chat-status")).toHaveLength(2);
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
        frozen.unmount();

        // A receipt re-ask names no plain question to send.
        render(
            <AskDevChat
                source={hostSource(
                    snapshotOf(userTurn(0, "First?"), assistantTurn(1, stalled, undefined)),
                )}
            />,
        );
        expect(screen.getByTestId("chat-status")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("renders the host's connect slot after the words, for connect only", () => {
        const connect = vi.fn(() => <a href="/connect">Connect Ask Dev</a>);
        const { unmount } = render(
            <AskDevChat
                source={hostSource(statusSnapshot({ kind: "connect" }), { slots: { connect } })}
            />,
        );
        const link = within(screen.getByTestId("chat-status")).getByRole("link", {
            name: "Connect Ask Dev",
        });
        expect(
            screen
                .getByTestId("chat-status")
                .querySelector(".chat__status-words")
                ?.compareDocumentPosition(link),
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        unmount();

        connect.mockClear();
        render(
            <AskDevChat
                source={hostSource(statusSnapshot({ kind: "stalled" }), { slots: { connect } })}
            />,
        );
        expect(connect).not.toHaveBeenCalled();
        expect(screen.queryByRole("link", { name: "Connect Ask Dev" })).toBeNull();
    });

    it("words a connect status without a slot, and renders no empty slot", () => {
        render(<AskDevChat source={hostSource(statusSnapshot({ kind: "connect" }))} />);
        expect(screen.getByTestId("chat-status").querySelector(".chat__status-slot")).toBeNull();
    });

    it.each([
        [1, "Try again in 1 second."],
        [45, "Try again in 45 seconds."],
        [60, "Try again in about 1 minute."],
        [125, "Try again in about 3 minutes."],
        [3_600, "Try again in about 1 hour."],
    ])("shows the wait line of a limit with a %d s wait", (retryAfterSeconds, line) => {
        render(
            <AskDevChat
                source={hostSource(
                    statusSnapshot({ kind: "limited", which: "org", retryAfterSeconds }),
                )}
            />,
        );
        expect(screen.getByTestId("chat-status-retry-after")).toHaveTextContent(line);
    });

    it("shows no wait line when the limit names no wait", () => {
        render(
            <AskDevChat source={hostSource(statusSnapshot({ kind: "limited", which: "org" }))} />,
        );
        expect(screen.queryByTestId("chat-status-retry-after")).toBeNull();
    });
});

describe("AskDevChat with a host source: Stop", () => {
    const running = progressSnapshot({ phase: "running" });

    it("shows Stop when the snapshot is stoppable and the source can stop, and calls stop()", async () => {
        const user = userEvent.setup();
        const stop = vi.fn();
        render(<AskDevChat source={hostSource({ ...running, stoppable: true }, { stop })} />);
        await user.click(screen.getByRole("button", { name: "Stop" }));
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it("shows no Stop when the snapshot is not stoppable", () => {
        render(<AskDevChat source={hostSource(running, { stop: vi.fn() })} />);
        expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });

    it("shows no Stop when the source cannot stop", () => {
        render(<AskDevChat source={hostSource({ ...running, stoppable: true })} />);
        expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });

    it("follows the snapshot as it changes", () => {
        const source = hostSource(running, { stop: vi.fn() });
        render(<AskDevChat source={source} />);
        expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
        act(() => {
            source.publish({ ...running, stoppable: true });
        });
        expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    });
});

describe("AskDevChat with a host source: asking", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function answeredTurn(id: number, result: InvestigationResult): ChatTurn {
        return assistantTurn(id, { kind: "answered", result });
    }

    it("asks through the source and never calls the network itself", async () => {
        const user = userEvent.setup();
        const network = vi.fn();
        vi.stubGlobal("fetch", network);
        const source = hostSource(snapshotOf());
        render(<AskDevChat source={source} />);
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Is Atlas on track?");
        await user.click(screen.getByRole("button", { name: "Send" }));
        expect(source.ask).toHaveBeenCalledWith("Is Atlas on track?", {
            narrowingRoot: undefined,
            selectionEvents: [],
        });
        expect(network).not.toHaveBeenCalled();
    });

    it("renders a turn the host publishes, with the host's own real result", () => {
        const source = hostSource(snapshotOf());
        render(<AskDevChat source={source} />);
        act(() => {
            source.publish(
                snapshotOf(
                    userTurn(0, "Is Ask Dev ready?"),
                    answeredTurn(
                        1,
                        structuredClone(canonicalResult) as unknown as InvestigationResult,
                    ),
                ),
            );
        });
        expect(screen.getByRole("log")).toHaveTextContent("Ask Dev is not release-ready.");
    });

    it("New question calls newConversation", async () => {
        const user = userEvent.setup();
        const source = hostSource(
            snapshotOf(
                userTurn(0, "Is Ask Dev ready?"),
                answeredTurn(1, structuredClone(canonicalResult) as unknown as InvestigationResult),
            ),
        );
        render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "New question" }));
        expect(source.newConversation).toHaveBeenCalledTimes(1);
    });

    it("the popup's last Continue fans out through askBatch with the render's intent", async () => {
        const user = userEvent.setup();
        const scenario = mockScenarios().find((entry) => entry.id === "clarification")!;
        const result: InvestigationResult = {
            ...structuredClone(scenario.result),
            structure_needs: {
                missing: ["subject_candidate"],
                candidate_options: [
                    {
                        receipt_id: "candr_container_0001",
                        option_id: "candidate_container",
                        label: "Container",
                        kind: "project",
                        canonical_id: "project:container",
                        offer_source: "engine",
                    },
                ],
            },
        };
        const source = hostSource(
            snapshotOf(userTurn(0, result.question), answeredTurn(1, result)),
        );
        render(<AskDevChat source={source} />);

        await user.click(screen.getByRole("button", { name: /Container/ }));
        await user.click(screen.getByRole("button", { name: /^Continue/ }));
        await waitFor(() =>
            expect(document.querySelector(".clarification-popup")?.textContent).toMatch(/Atlas/),
        );
        await user.click(
            within(document.querySelector<HTMLElement>(".clarification-popup")!).getAllByRole(
                "button",
                { name: /Atlas/ },
            )[0]!,
        );
        await user.click(screen.getByRole("button", { name: /^Continue with/ }));

        await waitFor(() => expect(source.askBatch).toHaveBeenCalledTimes(1));
        const [items, question, supersedes] = source.askBatch.mock.calls[0]!;
        expect(question).toBe(result.question);
        // CHAOS-12003: both picks ride ONE item.
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            priorSubjectReceipts: [
                { result_id: result.result_id, receipt_id: "receipt_atlas_project" },
            ],
            structureBatch: {
                subject_candidate: {
                    result_id: result.result_id,
                    receipt_id: "candr_container_0001",
                },
            },
            chosenSubject: { label: "Atlas" },
        });
        expect(supersedes?.turnId).toBe(1);
        expect([...(supersedes?.submittedCandidateReceiptIds ?? [])]).toEqual([
            "receipt_atlas_project",
        ]);
        expect([...(supersedes?.submittedStructureCandidateReceiptIds ?? [])]).toEqual([
            "candr_container_0001",
        ]);
        expect(source.ask).not.toHaveBeenCalled();
    });
});

describe("AskDevChat with a host source: what the render sends", () => {
    function resultOf(id: string): InvestigationResult {
        const scenario = mockScenarios().find((entry) => entry.id === id);
        if (scenario === undefined) throw new Error(`no scenario ${id}`);
        return structuredClone(scenario.result);
    }

    function popup(): HTMLElement {
        const found = document.querySelector<HTMLElement>(".clarification-popup");
        if (found === null) throw new Error("no popup");
        return found;
    }

    function answered(result: InvestigationResult): ChatSnapshot {
        return snapshotOf(
            userTurn(0, result.question),
            assistantTurn(1, { kind: "answered", result }),
        );
    }

    it("fans two subject picks out to two items; only the first carries the telemetry", async () => {
        const user = userEvent.setup();
        const result = resultOf("clarification");
        const source = hostSource(answered(result));
        render(<AskDevChat source={source} />);

        for (const option of within(popup()).getAllByRole("button", { name: /atlas/i })) {
            await user.click(option);
        }
        await user.click(screen.getByRole("button", { name: /^Continue with/ }));

        await waitFor(() => expect(source.askBatch).toHaveBeenCalledTimes(1));
        const [items] = source.askBatch.mock.calls[0]!;
        expect(items.map((item) => item.priorSubjectReceipts)).toEqual([
            [{ result_id: result.result_id, receipt_id: "receipt_atlas_project" }],
            [{ result_id: result.result_id, receipt_id: "receipt_atlas_repository" }],
        ]);
        expect(items[0]?.selectionEvents).toHaveLength(2);
        expect(items[1]?.selectionEvents).toEqual([]);
    });

    it("a plain ask carries the telemetry of a pick never confirmed", async () => {
        const user = userEvent.setup();
        const source = hostSource(answered(resultOf("clarification")));
        render(<AskDevChat source={source} />);

        await user.click(within(popup()).getAllByRole("button", { name: /atlas/i })[0]!);
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Something else");
        await user.click(screen.getByRole("button", { name: "Send" }));

        await waitFor(() => expect(source.ask).toHaveBeenCalledTimes(1));
        expect(source.ask.mock.calls[0]?.[0]).toBe("Something else");
        expect(source.ask.mock.calls[0]?.[1]?.selectionEvents).toHaveLength(1);
    });

    it("one structure pick is one ask, carrying the batch and what it supersedes", async () => {
        const user = userEvent.setup();
        const scenario = structureMockScenarios().find((entry) => entry.id === "structure-kind");
        if (scenario === undefined) throw new Error("no structure-kind scenario");
        const { result } = scenario;
        const source = hostSource(answered(result));
        render(<AskDevChat source={source} />);

        await user.click(within(popup()).getByRole("button", { name: /Pull request/ }));

        await waitFor(() => expect(source.ask).toHaveBeenCalledTimes(1));
        const [question, intent] = source.ask.mock.calls[0]!;
        const receipt = { result_id: result.result_id, receipt_id: "kindr_pull_request_0001" };
        expect(question).toBe(result.question);
        expect(intent?.structureBatch).toEqual({ expected_kind: receipt });
        expect(intent?.supersedes).toMatchObject({
            turnId: 1,
            submittedStructureBatch: { expected_kind: receipt },
        });
        expect(source.askBatch).not.toHaveBeenCalled();
    });

    it("a narrower re-ask names the chain's root question to the source", async () => {
        const user = userEvent.setup();
        const source = hostSource(
            snapshotOf(userTurn(0, "Rank all repositories, top 5 only"), {
                ...assistantTurn(1, {
                    kind: "failed",
                    failure: {
                        code: "acr_rejected_request",
                        httpStatus: 413,
                        message: "ACR rejected the investigation request.",
                        narrowerContinuation: {
                            axis: "result_count",
                            family: "discovered_cohort_ranking",
                        },
                        retryable: false,
                    },
                }),
                retryQuestion: "Rank all repositories, top 5 only",
                rootQuestion: "Rank all repositories",
            } as ChatTurn),
        );
        render(<AskDevChat source={source} />);

        await user.click(screen.getByRole("button", { name: "Ask for fewer results" }));

        await waitFor(() => expect(source.ask).toHaveBeenCalledTimes(1));
        expect(source.ask.mock.calls[0]?.[1]?.narrowingRoot).toBe("Rank all repositories");
        // A narrower question is a new question, under a new key.
        expect(source.retry).not.toHaveBeenCalled();
    });
});

describe("AskDevChat with a host source: the withheld boundary (F1)", () => {
    // The same person cohort `src/lib/withheld-render.test.tsx` builds, over a real capture.
    function personify(source: InvestigationResultV1): InvestigationResultV1 {
        return {
            ...source,
            cohort: {
                ...source.cohort!,
                kind: "person",
                members: source.cohort!.members.map((member) => ({
                    ...member,
                    subject: {
                        ...member.subject,
                        kind: "person",
                        canonical_id: "person:ada",
                        label: "Ada",
                    },
                })),
            },
        };
    }

    const rankable = shapesExample as unknown as InvestigationResultV1;
    const personResult = personify(rankable);

    function answeredBy(outcome: AssistantOutcome): ChatSnapshot {
        return snapshotOf(userTurn(0, "Who ships the most?"), assistantTurn(1, outcome));
    }

    it("holds the control: the rankable capture renders tables and charts", () => {
        render(
            <AskDevChat source={hostSource(answeredBy({ kind: "answered", result: rankable }))} />,
        );
        expect(screen.getByRole("log").querySelectorAll("table").length).toBeGreaterThan(0);
        expect(screen.queryByTestId("ranking-withheld-notice")).toBeNull();
    });

    it("a host's raw person cohort reaches no table and no chart, and the notice shows", () => {
        render(
            <AskDevChat
                source={hostSource(answeredBy({ kind: "answered", result: personResult }))}
            />,
        );
        const log = screen.getByRole("log");
        expect(log.querySelectorAll("table")).toHaveLength(0);
        expect(log.querySelectorAll("svg")).toHaveLength(0);
        expect(screen.getByTestId("ranking-withheld-notice")).toBeInTheDocument();
    });

    it("the popup reads the withheld result: a dropped offer opens no popup", () => {
        const offers: Pick<InvestigationResultV1, "structure_needs"> = {
            structure_needs: {
                missing: ["subject_candidate"],
                candidate_options: [
                    {
                        receipt_id: "candr_container_0001",
                        option_id: "candidate_container",
                        label: "Container",
                        kind: "project",
                        canonical_id: "project:container",
                        offer_source: "engine",
                    },
                ],
            },
        };
        const control = render(
            <AskDevChat
                source={hostSource(
                    answeredBy({ kind: "answered", result: { ...rankable, ...offers } }),
                )}
            />,
        );
        expect(document.querySelector(".clarification-popup")).not.toBeNull();
        control.unmount();

        render(
            <AskDevChat
                source={hostSource(
                    answeredBy({ kind: "answered", result: { ...personResult, ...offers } }),
                )}
            />,
        );
        expect(document.querySelector(".clarification-popup")).toBeNull();
    });

    it("an already-withheld result with a marker keeps the notice", () => {
        const first = withholdUnrankableRankings(personResult);
        render(
            <AskDevChat
                source={hostSource(
                    answeredBy({
                        kind: "answered",
                        result: first.result,
                        rankingWithheld: first.rankingWithheld!,
                    }),
                )}
            />,
        );
        expect(screen.getByTestId("ranking-withheld-notice")).toBeInTheDocument();
    });

    it("a rankable turn keeps its object identity; a person turn does not", () => {
        const kept = assistantTurn(1, { kind: "answered", result: rankable });
        expect(withheldTurn(kept)).toBe(kept);
        const changed = assistantTurn(1, { kind: "answered", result: personResult });
        expect(withheldTurn(changed)).not.toBe(changed);
        expect(withheldTurn(changed)).toMatchObject({
            outcome: { rankingWithheld: { reason: "subject_kind_not_ranked" } },
        });
    });

    it("returns a turn without a result unchanged", () => {
        const user = userTurn(0, "Who ships the most?");
        const pending = assistantTurn(1, { kind: "pending" });
        const stalled = assistantTurn(1, {
            kind: "status",
            status: { kind: "stalled" },
            retry: false,
        });
        expect(withheldTurn(user)).toBe(user);
        expect(withheldTurn(pending)).toBe(pending);
        expect(withheldTurn(stalled)).toBe(stalled);
    });
});

describe("AskDevChat on the standalone source: unchanged", () => {
    const TODAY_PENDING = '<p class="chat__pending" role="status">Investigating…</p>';

    it("renders today's pending markup and text, and no Stop", async () => {
        const user = userEvent.setup();
        let answer: (payload: unknown) => void = () => undefined;
        const fetchImpl = (() =>
            new Promise((resolve) => {
                answer = (payload) => {
                    resolve({ json: () => Promise.resolve(payload) });
                };
            })) as unknown as typeof fetch;
        render(<AskDevChat source={createStandaloneSource(fetchImpl)} />);

        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Is Ask Dev ready?");
        await user.click(screen.getByRole("button", { name: "Send" }));

        const pending = document.querySelector(".chat__pending");
        expect(pending?.outerHTML).toBe(TODAY_PENDING);
        expect(pending?.parentElement?.classList.contains("chat__turn--assistant")).toBe(true);
        expect(screen.queryByTestId("chat-progress")).toBeNull();
        expect(document.querySelector(".chat__stages")).toBeNull();
        expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
        expect(document.querySelector(".chat__stop-row")).toBeNull();

        act(() => {
            answer({ result: canonicalResult });
        });
        await waitFor(() => expect(document.querySelector(".chat__pending")).toBeNull());
        expect(screen.getByRole("log")).toHaveTextContent("Ask Dev is not release-ready.");
        expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
        expect(screen.queryByTestId("chat-status")).toBeNull();
    });

    it("a Retry sends today's body, and an answered Retry clears the draft", async () => {
        const user = userEvent.setup();
        const bodies: unknown[] = [];
        const replies: unknown[] = [
            { failure: { code: "acr_unreachable", message: "Gone.", retryable: true } },
            { result: canonicalResult },
        ];
        const fetchImpl = ((_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            return Promise.resolve({ json: () => Promise.resolve(replies.shift()) });
        }) as unknown as typeof fetch;
        render(<AskDevChat source={createStandaloneSource(fetchImpl)} />);
        const composer = screen.getByPlaceholderText(/Ask about a project/);

        await user.type(composer, "Is Ask Dev ready?");
        await user.click(screen.getByRole("button", { name: "Send" }));
        await screen.findByRole("button", { name: "Retry" });
        expect(composer).toHaveValue("Is Ask Dev ready?");

        await user.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(composer).toHaveValue(""));
        expect(bodies).toEqual([
            { question: "Is Ask Dev ready?", priorSubjectReceipts: [], conversation: [] },
            {
                question: "Is Ask Dev ready?",
                priorSubjectReceipts: [],
                conversation: [
                    {
                        turn_id: "turn_0",
                        role: "user",
                        content: "Is Ask Dev ready?",
                        created_at: expect.any(String) as string,
                    },
                ],
            },
        ]);
    });

    it("with no prop, runs on its own source over the global fetch", async () => {
        const user = userEvent.setup();
        const network = vi.fn(() =>
            Promise.resolve({ json: () => Promise.resolve({ result: canonicalResult }) }),
        );
        vi.stubGlobal("fetch", network);
        render(<AskDevChat />);
        await user.type(screen.getByPlaceholderText(/Ask about a project/), "Is Ask Dev ready?");
        await user.click(screen.getByRole("button", { name: "Send" }));
        await waitFor(() =>
            expect(screen.getByRole("log")).toHaveTextContent("Ask Dev is not release-ready."),
        );
        expect(network).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });
});

describe("AskDevChat: a host swaps the source", () => {
    function clarificationSource(): HostSource {
        const scenario = mockScenarios().find((entry) => entry.id === "clarification")!;
        const result = structuredClone(scenario.result);
        return hostSource(
            snapshotOf(
                userTurn(0, result.question),
                assistantTurn(1, { kind: "answered", result }),
            ),
        );
    }

    it("a dismissal in the old conversation does not hide the new one's popup", async () => {
        const user = userEvent.setup();
        const view = render(<AskDevChat source={clarificationSource()} />);
        await user.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByRole("dialog")).toBeNull();

        // Turn ids are unique per source only: the new source reuses id 1.
        view.rerender(<AskDevChat source={clarificationSource()} />);

        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("keeps the UI state while the host passes the same source again", async () => {
        const user = userEvent.setup();
        const source = clarificationSource();
        const view = render(<AskDevChat source={source} />);
        await user.click(screen.getByRole("button", { name: "Dismiss" }));

        view.rerender(<AskDevChat source={source} />);

        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("AskDevChat: the pin when a draft clears", () => {
    it("pins again after the answered ask clears the draft", async () => {
        const user = userEvent.setup();
        const fetchImpl = (() =>
            Promise.resolve({
                json: () => Promise.resolve({ result: canonicalResult }),
            })) as unknown as typeof fetch;
        render(<AskDevChat source={createStandaloneSource(fetchImpl)} />);
        const log = screen.getByRole("log", { name: "Conversation" });
        const box = screen.getByPlaceholderText<HTMLTextAreaElement>(/Ask about a project/);
        // jsdom has no layout. In a browser the empty composer takes another height, which moves
        // the log's bottom: the wrapped placeholder is taller than a one-line draft.
        const bottomWith = { draft: 100, empty: 120 };
        let written = 0;
        Object.defineProperty(log, "scrollHeight", {
            configurable: true,
            get: () => (box.value === "" ? bottomWith.empty : bottomWith.draft),
        });
        Object.defineProperty(log, "scrollTop", {
            configurable: true,
            get: () => written,
            set: (value: number) => {
                written = value;
            },
        });

        await user.type(box, "Is Ask Dev ready?");
        await user.click(screen.getByRole("button", { name: "Send" }));

        await waitFor(() => expect(box.value).toBe(""));
        await waitFor(() => expect(written).toBe(bottomWith.empty));
    });
});
