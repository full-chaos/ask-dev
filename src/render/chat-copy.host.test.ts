import { describe, expect, it } from "vitest";

import * as entry from "./index";
import {
    COMPOSER_COPY,
    CONTEXT_CHIPS_COPY,
    CTA_LABELS,
    FEEDBACK_COPY,
    HISTORY_COPY,
    historyRowLabel,
    historyRowMeta,
    historyRowTitle,
    removeLabel,
    SCOPE_KIND_LABEL,
    TRANSCRIPT_COPY,
} from "./chat-copy";
import {
    composerLockOf,
    FEEDBACK_QUESTIONS,
    isNonAnswer,
    type ChatHistoryRow,
    type ChatThreadAccess,
    type ComposerLock,
    type FeedbackQuestion,
    type ScopeKind,
} from "./source";

/**
 * CHAOS-12387: the words of what only a host offers. They are web's words: web's specs pin them, so
 * each is written out here against the table, and each table is exhaustive by type.
 */

const SCOPE_WORDS: Record<ScopeKind, string> = {
    organization: "Organization",
    team: "Team",
    project: "Project",
    repository: "Repository",
    work_item: "Work item",
    pull_request: "Pull request",
};

const QUESTION_WORDS: Record<FeedbackQuestion, string> = {
    correct: "Correct?",
    useful: "Useful?",
};

const LOCK_CASES: Record<ComposerLock, true> = {
    signed_out: true,
    restoring: true,
    read_only: true,
};

describe("the host word tables", () => {
    it.each(
        Object.entries({
            HISTORY_COPY,
            FEEDBACK_COPY,
            TRANSCRIPT_COPY,
            CONTEXT_CHIPS_COPY,
            SCOPE_KIND_LABEL,
            CTA_LABELS,
            COMPOSER_COPY,
        }),
    )("%s: every entry is a non-empty string", (_name, table) => {
        const entries = Object.entries(table);
        expect(entries.length).toBeGreaterThan(0);
        for (const [key, value] of entries) {
            expect(typeof value, key).toBe("string");
            expect((value as string).trim(), key).not.toBe("");
        }
    });

    it("HISTORY_COPY holds web's words", () => {
        expect(HISTORY_COPY).toEqual({
            title: "Conversations",
            loading: "Loading conversations…",
            empty: "No conversations yet.",
            readFailed: "History could not be read.",
            connect:
                "Ask Dev needs your permission to show your conversations. Connect Ask Dev to see them.",
            moreFailed: "More conversations could not be loaded.",
            current: "Current",
            confirm: "Delete this conversation? This cannot be undone.",
            confirmRunning: "This does not stop the running question.",
            deleteFailed: "This conversation was not deleted. Try again.",
        });
    });

    it("FEEDBACK_COPY holds web's words, and a line for each question", () => {
        expect(FEEDBACK_COPY).toEqual({
            region: "Feedback on this answer",
            ...QUESTION_WORDS,
            yes: "Yes",
            no: "No",
            readFailed: "Feedback could not be read.",
            notSaved: "Feedback was not saved.",
        });
        expect([...FEEDBACK_QUESTIONS]).toEqual(Object.keys(QUESTION_WORDS));
    });

    it("TRANSCRIPT_COPY holds web's words", () => {
        expect(TRANSCRIPT_COPY).toEqual({
            empty: "Your conversation will appear here.",
            notSaved: "This conversation was not saved yet.",
            notSavedHint: "Reloading the page started a new one. Ask again to continue.",
            loading: "Loading this conversation…",
            unavailable: "This conversation is not available.",
            unavailableHint: "Start a new conversation, or open another one from the history.",
            readFailed: "This conversation could not be read.",
            connect:
                "Ask Dev needs your permission to show this conversation. Connect Ask Dev to see it.",
            earlierFailed: "Earlier turns could not be loaded.",
            lockedRestoring: "Loading the conversation…",
            lockedReadOnly: "Start a new conversation to ask a question.",
        });
    });

    it("CONTEXT_CHIPS_COPY and SCOPE_KIND_LABEL hold web's words", () => {
        expect(CONTEXT_CHIPS_COPY).toEqual({
            title: "Context from this page",
            note: "Sent as hints with your next question. Remove any you do not want.",
        });
        expect(SCOPE_KIND_LABEL).toEqual(SCOPE_WORDS);
    });

    it("CTA_LABELS holds the ones the render uses, under web's keys", () => {
        expect(CTA_LABELS).toEqual({
            askDevBackToConversation: "Back to conversation",
            askDevDeleteConversation: "Delete conversation",
            askDevHistory: "History",
            askDevNewConversation: "New conversation",
            askDevShowEarlierTurns: "Show earlier turns",
            askDevShowMoreConversations: "Show more",
            cancel: "Cancel",
            confirmDelete: "Confirm delete?",
            remove: "Remove",
            tryAgain: "Try again",
        });
    });

    it("COMPOSER_COPY holds web's signed-out line", () => {
        expect(COMPOSER_COPY).toEqual({ signedOut: "Sign in again to ask a question." });
    });
});

describe("the history row helpers", () => {
    const row: ChatHistoryRow = {
        id: "thread_1",
        firstQuestion: null,
        lastTurnAt: "2026-10-30T12:00:00.000Z",
        turnCount: 3,
    };
    const when = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(row.lastTurnAt));

    it("historyRowMeta: the date and the count", () => {
        expect(historyRowMeta(row)).toBe(`${when} · 3 questions`);
        expect(historyRowMeta({ ...row, turnCount: 1 })).toBe(`${when} · 1 question`);
        expect(historyRowMeta({ ...row, turnCount: 0 })).toBe(`${when} · 0 questions`);
    });

    it("historyRowMeta: a date it cannot read is shown as it came", () => {
        expect(historyRowMeta({ ...row, lastTurnAt: "not a date" })).toBe(
            "not a date · 3 questions",
        );
    });

    it("historyRowLabel: names a row with no first question", () => {
        expect(historyRowLabel(row)).toBe(`Conversation of ${when} · 3 questions`);
    });

    it("historyRowTitle: the first question, or null for none or only blanks", () => {
        expect(historyRowTitle({ ...row, firstQuestion: "  Who?  " })).toBe("  Who?  ");
        expect(historyRowTitle(row)).toBeNull();
        expect(historyRowTitle({ ...row, firstQuestion: " \n\t " })).toBeNull();
        expect(historyRowTitle({ ...row, firstQuestion: "" })).toBeNull();
    });
});

describe("removeLabel", () => {
    it("names the action, the kind and the label", () => {
        expect(removeLabel({ kind: "work_item", id: "w1", label: "CHAOS-1" })).toBe(
            "Remove Work item CHAOS-1",
        );
    });
});

describe("isNonAnswer", () => {
    it("is web's rule: a clarification or a no-match asks nothing to judge", () => {
        expect(isNonAnswer("clarification_required")).toBe(true);
        expect(isNonAnswer("no_match")).toBe(true);
        expect(isNonAnswer("complete")).toBe(false);
        expect(isNonAnswer("degraded")).toBe(false);
    });
});

describe("composerLockOf", () => {
    const kinds: readonly (readonly [
        ChatThreadAccess | undefined,
        ComposerLock | undefined,
        ComposerLock | undefined,
    ])[] = [
        // thread, not locked, locked
        [undefined, undefined, "signed_out"],
        [{ kind: "new" }, undefined, "signed_out"],
        [{ kind: "loaded", earlier: "none" }, undefined, "restoring"],
        [{ kind: "restoring" }, "restoring", "restoring"],
        [{ kind: "unavailable" }, "read_only", "read_only"],
        [{ kind: "read_failed" }, "read_only", "read_only"],
        [{ kind: "connect" }, "read_only", "read_only"],
    ];

    it.each(kinds)("%j: %s without composerLocked, %s with it", (thread, open, locked) => {
        const base = thread === undefined ? {} : { thread };
        expect(composerLockOf(base)).toBe(open);
        expect(composerLockOf({ ...base, composerLocked: false })).toBe(open);
        expect(composerLockOf({ ...base, composerLocked: true })).toBe(locked);
    });

    it("every lock is reachable", () => {
        const reached = new Set(kinds.flatMap(([, open, locked]) => [open, locked]));
        for (const lock of Object.keys(LOCK_CASES)) {
            expect(reached.has(lock as ComposerLock), lock).toBe(true);
        }
    });
});

describe("the render entry", () => {
    it("exports the tables and the helpers a host needs", () => {
        for (const name of [
            "COMPOSER_COPY",
            "COMPOSER_LOCK_WORDS",
            "CONTEXT_CHIPS_COPY",
            "CTA_LABELS",
            "FEEDBACK_COPY",
            "FEEDBACK_QUESTIONS",
            "HISTORY_COPY",
            "SCOPE_KIND_LABEL",
            "TRANSCRIPT_COPY",
            "composerLockOf",
            "historyRowLabel",
            "historyRowMeta",
            "historyRowTitle",
            "isNonAnswer",
            "removeLabel",
        ] as const) {
            expect(entry[name], name).toBeDefined();
        }
    });
});
