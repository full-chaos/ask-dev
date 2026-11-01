/**
 * The words of a turn's progress and status (CHAOS-12382), and of what only a host offers
 * (CHAOS-12387).
 *
 * `CHAT_STATUS_COPY` and `CHAT_PROGRESS_COPY` are web's strings, copied exactly: web drives this
 * render from its own store, and web's tests pin these words. Change one here only together with
 * web. `NOT_RUN_COPY`, `STOPPED_COPY`, `CHAT_STAGE_COPY`, `retryAfterText` and `formatElapsed` are
 * web's too, copied the same way, and so are `HISTORY_COPY`, `FEEDBACK_COPY`, `TRANSCRIPT_COPY`,
 * `COMPOSER_COPY`, `CONTEXT_CHIPS_COPY`, `SCOPE_KIND_LABEL`, `CTA_LABELS` and the row helpers.
 * `CHAT_PROGRESS_COPY.queued` and `.batchPosition` are ask-dev's (CHAOS-12406): web's source sends
 * them, and web has no words for them yet.
 */
import type {
    ChatContextRef,
    ChatHistoryRow,
    ChatStatus,
    ComposerLock,
    FeedbackQuestion,
    InvestigationStage,
    NotRunReason,
    ScopeKind,
    StageRowState,
    StoppedReason,
} from "./source";

/** What to do after ACR refused a question before it ran. */
export const NOT_RUN_COPY: Readonly<Record<NotRunReason, string>> = {
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

/** Why ACR stopped a run after it started. No retry: the way on is a new question. */
export const STOPPED_COPY: Readonly<Record<StoppedReason, string>> = {
    rate_limited: "This question was rate limited after it started. Wait a moment, then ask again.",
    interpretation_rejected:
        "Dev could not accept an interpretation of your question. Try rephrasing it.",
    synthesis_rejected: "Dev could not accept a generated answer. Try rephrasing your question.",
};

export const CHAT_STATUS_COPY = {
    failedRetry: "The question could not be sent. Try again.",
    failed: "The investigation did not finish. Ask again.",
    reference: "Reference",
    deadline: {
        model: "A model step ran out of time, so the investigation stopped before an answer. Ask again, or ask a narrower question.",
        request:
            "The investigation ran out of time before an answer. Ask again, or ask a narrower question.",
        admission: "Ask Dev did not start the investigation in time. Ask again.",
        budget_exhausted: "Ask Dev ran out of time before the question could start. Ask again.",
    },
    limited: {
        principal:
            "You already have as many questions running as Ask Dev allows. Wait for one to finish, then try again.",
        org: "Your organization already has as many questions running as Ask Dev allows. Try again shortly.",
        concurrency: "Too many questions are running at once. Try again shortly.",
        allowance: "Your organization has used this month's Ask Dev allowance.",
    },
    stream_unavailable:
        "Ask Dev cannot stream answers on this deployment right now. Contact your administrator.",
    mismatch: "This question could not be sent again as it was first sent. Ask again.",
    unsaved: "The answer was shown but not saved — ask again",
    abandoned: "An earlier run of this question ended without an answer. Ask again.",
    interrupted: "Interrupted — ask again",
    stalled: "The answer stopped arriving. Ask again.",
    canceled: "Canceled. If the answer had already finished, it is kept.",
    halted: "Stopped or interrupted. Ask again.",
    connect:
        "Ask Dev needs your permission to answer from your data. Connect Ask Dev, then ask again.",
    thread_closed:
        "This conversation has ended (deleted, expired or full). Ask again to start a new one.",
    unavailable: "This answer is not available to you now.",
    restore_failed: "This answer could not be loaded.",
    unconfirmed: "The current state could not be confirmed. Check back later.",
    /** The button of a `restore_failed` turn. Web's `CTA_LABELS.askDevLoadAgain`. */
    loadAgain: "Load again",
    /** A turn ACR admitted before it recorded questions. Display only: it is never sent. */
    questionNotRecorded: "Question not recorded",
} as const satisfies {
    readonly deadline: Record<Extract<ChatStatus, { kind: "deadline" }>["which"], string>;
    readonly limited: Record<Extract<ChatStatus, { kind: "limited" }>["which"], string>;
} & Record<
    | Exclude<ChatStatus["kind"], "deadline" | "limited" | "not_run" | "stopped">
    | "failedRetry"
    | "reference"
    | "loadAgain"
    | "questionNotRecorded",
    string
>;

export const CHAT_PROGRESS_COPY = {
    running: "Investigating…",
    recovering: "The connection dropped. Checking whether the answer finished…",
    observing:
        "This question was still running when the conversation was loaded. Checking for its answer…",
    restoring: "Loading this answer…",
    /** Followed by the local time. */
    lastSeenRunning: "Last seen running at",
    canceling: "Canceling…",
    stopRequested: "Stopping…",
    stopNotLeased: "This run cannot be stopped. It ends on its own.",
    queued: "Waiting for the question before it to finish.",
    batchPosition: (position: number, total: number) =>
        `Question ${String(position)} of ${String(total)}`,
} as const;

/** The stage checklist: one line per ACR stage, and each row's state for a screen reader. */
export const CHAT_STAGE_COPY = {
    steps: "Investigation steps",
    elapsed: "Elapsed",
    stages: {
        interpreting: "Reading the question",
        resolving_subjects: "Finding what the question is about",
        reading_facts: "Reading stored facts",
        synthesizing: "Drafting the answer",
        validating: "Checking the answer",
    },
    state: {
        done: "done",
        active: "in progress",
        skipped: "skipped",
        pending: "not started",
    },
} as const satisfies {
    readonly steps: string;
    readonly elapsed: string;
    readonly stages: Record<InvestigationStage, string>;
    readonly state: Record<StageRowState, string>;
};

/** The labels of web's `CTA_LABELS` this render uses, under web's keys. */
export const CTA_LABELS = {
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
} as const;

/** The words of an opened evidence reference (`ChatEvidenceBody`). Served text is never here. */
export const EVIDENCE_COPY = {
    loading: "Loading this evidence…",
    stale: "This evidence may be out of date.",
    observed: "Observed",
    redacted: "Part of this evidence is withheld.",
    notFound: "This evidence is not available.",
    unavailable: "This evidence could not be read.",
    details: "Details",
} as const;

/** The saved conversations. */
export const HISTORY_COPY = {
    title: "Conversations",
    loading: "Loading conversations…",
    empty: "No conversations yet.",
    readFailed: "History could not be read.",
    /** The host holds no access for the list. Its Connect slot follows. */
    connect:
        "Ask Dev needs your permission to show your conversations. Connect Ask Dev to see them.",
    moreFailed: "More conversations could not be loaded.",
    current: "Current",
    confirm: "Delete this conversation? This cannot be undone.",
    /** Delete is not Stop: a running question goes on. */
    confirmRunning: "This does not stop the running question.",
    deleteFailed: "This conversation was not deleted. Try again.",
} as const;

/** "<date> · <n> questions": when the conversation last moved, and how many questions it holds. */
export function historyRowMeta(row: ChatHistoryRow): string {
    const when = new Date(row.lastTurnAt);
    const date = Number.isNaN(when.getTime())
        ? row.lastTurnAt
        : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
              when,
          );
    const count = `${String(row.turnCount)} ${row.turnCount === 1 ? "question" : "questions"}`;
    return `${date} · ${count}`;
}

/** "Conversation of <date> · <n> questions": the name of a row with no first question. */
export function historyRowLabel(row: ChatHistoryRow): string {
    return `Conversation of ${historyRowMeta(row)}`;
}

/** The row's title: its first question, or `null` when none was served or only blanks. */
export function historyRowTitle(row: ChatHistoryRow): string | null {
    return row.firstQuestion !== null && row.firstQuestion.trim() !== "" ? row.firstQuestion : null;
}

/** Feedback on one answer. There is no free text. */
export const FEEDBACK_COPY = {
    region: "Feedback on this answer",
    correct: "Correct?",
    useful: "Useful?",
    yes: "Yes",
    no: "No",
    readFailed: "Feedback could not be read.",
    notSaved: "Feedback was not saved.",
} as const satisfies Record<
    FeedbackQuestion | "region" | "yes" | "no" | "readFailed" | "notSaved",
    string
>;

/** The conversation's own states, and the composer while it cannot take a question. */
export const TRANSCRIPT_COPY = {
    empty: "Your conversation will appear here.",
    notSaved: "This conversation was not saved yet.",
    notSavedHint: "Reloading the page started a new one. Ask again to continue.",
    loading: "Loading this conversation…",
    /** The same for every cause, so it says no cause. */
    unavailable: "This conversation is not available.",
    unavailableHint: "Start a new conversation, or open another one from the history.",
    readFailed: "This conversation could not be read.",
    /** The host holds no access for the read. Its Connect slot follows. */
    connect: "Ask Dev needs your permission to show this conversation. Connect Ask Dev to see it.",
    earlierFailed: "Earlier turns could not be loaded.",
    lockedRestoring: "Loading the conversation…",
    lockedReadOnly: "Start a new conversation to ask a question.",
} as const;

/** The composer's line for a viewer who is signed out. */
export const COMPOSER_COPY = { signedOut: "Sign in again to ask a question." } as const;

/** Why the composer refuses. */
export const COMPOSER_LOCK_WORDS: Readonly<Record<ComposerLock, string>> = {
    signed_out: COMPOSER_COPY.signedOut,
    restoring: TRANSCRIPT_COPY.lockedRestoring,
    read_only: TRANSCRIPT_COPY.lockedReadOnly,
};

export const SCOPE_KIND_LABEL = {
    organization: "Organization",
    team: "Team",
    project: "Project",
    repository: "Repository",
    work_item: "Work item",
    pull_request: "Pull request",
} as const satisfies Record<ScopeKind, string>;

export const CONTEXT_CHIPS_COPY = {
    title: "Context from this page",
    note: "Sent as hints with your next question. Remove any you do not want.",
} as const;

/** The accessible name of a chip's remove button: the action and what it removes. */
export function removeLabel(ref: ChatContextRef): string {
    return `${CTA_LABELS.remove} ${SCOPE_KIND_LABEL[ref.kind]} ${ref.label}`;
}

/** The words of one status. `retry` is the outcome's: only `failed` reads it. */
export function chatStatusWords(status: ChatStatus, retry: boolean): string {
    switch (status.kind) {
        case "failed":
            return retry ? CHAT_STATUS_COPY.failedRetry : CHAT_STATUS_COPY.failed;
        case "deadline":
            return CHAT_STATUS_COPY.deadline[status.which];
        case "limited":
            return CHAT_STATUS_COPY.limited[status.which];
        case "not_run":
            return NOT_RUN_COPY[status.reason];
        case "stopped":
            return STOPPED_COPY[status.reason];
        default:
            return CHAT_STATUS_COPY[status.kind];
    }
}

/** `m:ss` (or `h:mm:ss`) of a duration. A negative one reads as zero. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return hours > 0
        ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${seconds}`
        : `${String(minutes)}:${seconds}`;
}

const UNITS = [
    { seconds: 86_400, one: "day", many: "days" },
    { seconds: 3_600, one: "hour", many: "hours" },
    { seconds: 60, one: "minute", many: "minutes" },
] as const;

/**
 * ACR's `Retry-After` as a sentence: whole seconds under a minute, else about the next whole
 * minute, hour or day (rounded up, so the user does not try too early).
 */
export function retryAfterText(seconds: number): string {
    if (seconds <= 0) return "You can try again now.";
    if (seconds < 60) {
        return `Try again in ${String(seconds)} ${seconds === 1 ? "second" : "seconds"}.`;
    }
    const unit = UNITS.find((candidate) => seconds >= candidate.seconds) ?? UNITS[2];
    const count = Math.ceil(seconds / unit.seconds);
    return `Try again in about ${String(count)} ${count === 1 ? unit.one : unit.many}.`;
}
