/**
 * The words of a turn's progress and status (CHAOS-12382).
 *
 * `CHAT_STATUS_COPY` and `CHAT_PROGRESS_COPY` are web's strings, copied exactly: web drives this
 * render from its own store, and web's tests pin these words. Change one here only together with
 * web. `NOT_RUN_COPY`, `STOPPED_COPY`, `CHAT_STAGE_COPY`, `retryAfterText` and `formatElapsed` are
 * web's too, copied the same way.
 */
import type {
    ChatStatus,
    InvestigationStage,
    NotRunReason,
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
