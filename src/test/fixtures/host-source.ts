import { act } from "react";
import { vi } from "vitest";

import type {
    AssistantOutcome,
    ChatFeedbackEntry,
    ChatFeedbackSource,
    ChatHistorySnapshot,
    ChatHistorySource,
    ChatSnapshot,
    ChatSource,
    ChatTurn,
} from "@/render/source";

/**
 * A fake host source for the render's tests: a snapshot the test controls, and a recorded call for
 * every action. It stands where web's store will stand. The results a test puts on a turn come from
 * `src/contracts/examples` or `src/test/fixtures`, never from hand-written JSON.
 */

export const ASKED_AT = "2026-10-30T12:00:00.000Z";

export function userTurn(id: number, question: string | null): ChatTurn {
    return { role: "user", id, question, createdAt: ASKED_AT, showBubble: true };
}

export function assistantTurn(id: number, outcome: AssistantOutcome, question?: string): ChatTurn {
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

export function snapshotOf(...turns: readonly ChatTurn[]): ChatSnapshot {
    return { turns, stoppable: false };
}

type Capabilities = Partial<
    Pick<
        ChatSource,
        | "stop"
        | "slots"
        | "reloadTurn"
        | "history"
        | "feedback"
        | "pageContext"
        | "reloadThread"
        | "loadEarlier"
    >
>;

export type HostSource = Omit<ChatSource, "ask" | "askBatch" | "retry" | "newConversation"> & {
    /** Publishes a new snapshot, inside `act`. */
    readonly publish: (next: ChatSnapshot) => void;
    readonly ask: ReturnType<typeof vi.fn<ChatSource["ask"]>>;
    readonly askBatch: ReturnType<typeof vi.fn<ChatSource["askBatch"]>>;
    readonly retry: ReturnType<typeof vi.fn<ChatSource["retry"]>>;
    readonly newConversation: ReturnType<typeof vi.fn<ChatSource["newConversation"]>>;
};

export function hostSource(initial: ChatSnapshot, extra: Capabilities = {}): HostSource {
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
            act(() => {
                snapshot = next;
                for (const listener of listeners) listener();
            });
        },
    };
}

export function fakeHistory() {
    return {
        load: vi.fn<ChatHistorySource["load"]>(),
        loadMore: vi.fn<ChatHistorySource["loadMore"]>(),
        open: vi.fn<ChatHistorySource["open"]>(),
        remove: vi.fn<ChatHistorySource["remove"]>(),
    };
}

export function historySnapshot(overrides: Partial<ChatHistorySnapshot> = {}): ChatHistorySnapshot {
    return {
        status: "ready",
        rows: [],
        currentId: null,
        hasMore: false,
        loadingMore: false,
        moreFailed: false,
        deleting: [],
        deleteFailed: null,
        running: false,
        ...overrides,
    };
}

export function feedbackEntry(overrides: Partial<ChatFeedbackEntry> = {}): ChatFeedbackEntry {
    return {
        state: "ready",
        desired: { correct: "unset", useful: "unset" },
        saving: false,
        notSaved: false,
        ...overrides,
    };
}

/** A feedback store of one tab: its entries and its readiness are the test's to change. */
export function fakeFeedback(
    entries: Readonly<Record<string, ChatFeedbackEntry>> = {},
    ready = true,
) {
    const state = { ready, entries: new Map(Object.entries(entries)) };
    const listeners = new Set<() => void>();
    const notify = () => {
        act(() => {
            for (const listener of listeners) listener();
        });
    };
    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        isReady: () => state.ready,
        entryFor: (resultId: string) => state.entries.get(resultId),
        ensure: vi.fn<ChatFeedbackSource["ensure"]>(),
        retryRead: vi.fn<ChatFeedbackSource["retryRead"]>(),
        choose: vi.fn<ChatFeedbackSource["choose"]>(),
        listeners,
        setEntry(resultId: string, entry: ChatFeedbackEntry) {
            state.entries.set(resultId, entry);
            notify();
        },
        setReady(next: boolean) {
            state.ready = next;
            notify();
        },
    };
}
