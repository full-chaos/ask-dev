import type { ACRErrorV1 } from "../contracts/generated/error";

/**
 * The types an ACR browser client call speaks in. A host names its own result and status types
 * (`TResult`, `TStatus`): each host vendors the schemas it reads.
 */

/** ACR's closed stage vocabulary, in its one order (`context_fabric_investigation_event.v1`). */
export const INVESTIGATION_STAGES = [
    "interpreting",
    "resolving_subjects",
    "reading_facts",
    "synthesizing",
    "validating",
] as const;

export type InvestigationStage = (typeof INVESTIGATION_STAGES)[number];

type EventBase = { readonly seq: number; readonly request_id: string };

/**
 * One parsed `context_fabric_investigation_event.v1` event, as the store reads it. The transport
 * parses and checks the frames (T14 owns the grammar); `result` and `error` are terminal.
 */
export type InvestigationEvent<TResult> =
    | (EventBase & {
          readonly type: "accepted";
          readonly reserved_result_id: string;
          readonly submission_id?: string | undefined;
          readonly thread_id?: string | undefined;
          readonly started_at: string;
          readonly budget_seconds: number;
      })
    | (EventBase & {
          readonly type: "stage";
          readonly stage: InvestigationStage;
          readonly state: "started" | "completed";
          readonly elapsed_ms: number;
      })
    | (EventBase & {
          readonly type: "heartbeat";
          readonly stage?: InvestigationStage | undefined;
          /** Milliseconds since `started_at` (CHAOS-11957: the attach continuity check reads it). */
          readonly elapsed_ms: number;
      })
    | (EventBase & { readonly type: "result"; readonly result: TResult })
    | (EventBase & {
          readonly type: "error";
          readonly reserved_result_id: string;
          readonly error: ACRErrorV1;
          readonly stage?: InvestigationStage | undefined;
      });

export type InvestigateCall = {
    /** The wire request; sent byte for byte. */
    readonly request: unknown;
    /** `X-ACR-Submission-ID`: one per user submit, reused only to retry this identical request. */
    readonly submissionId: string;
    /** `X-ACR-Thread-ID`: one per conversation, sent on every turn. */
    readonly threadId: string;
    /**
     * The run's absolute deadline D (epoch ms). The transport computes ACR's wait-budget header from
     * what is left of it (plan §2.7.6); the caller aborts the run at D whatever it is waiting on.
     */
    readonly deadline: number;
    /** Aborting it is the only cancel (plan §2.7.4: a disconnect ends the run). */
    readonly signal: AbortSignal;
};

/**
 * ACR answered before the stream opened: an HTTP status and its `error.v1` body (for example
 * `409 submission_in_progress` on a retry while the first run is still live).
 *
 * `retryAfterSeconds` is ACR's `Retry-After` header in whole seconds, when the response had a
 * valid one (the 429s `concurrency_limited` and `allowance_exhausted`, and
 * `submission_in_progress`). The panel shows it (plan §2.7.8); the transport parses it.
 */
export class TransportRefusal extends Error {
    readonly status: number;
    readonly error: ACRErrorV1;
    readonly retryAfterSeconds: number | undefined;

    constructor(status: number, error: ACRErrorV1, retryAfterSeconds?: number) {
        super(`ACR refused the call: ${String(status)} ${error.error.code}`);
        this.name = "TransportRefusal";
        this.status = status;
        this.error = error;
        this.retryAfterSeconds =
            retryAfterSeconds !== undefined &&
            Number.isSafeInteger(retryAfterSeconds) &&
            retryAfterSeconds >= 0
                ? retryAfterSeconds
                : undefined;
    }
}

/**
 * Why the browser transport ended a run itself (plan §2.7.6 and §2.7.7, moved to the browser by
 * the direct-to-ACR amendment §6 and §8; CHAOS-11929). Each one has its own panel state:
 *
 * - `stalled`: no bytes for 30 s after `accepted`. The transport aborted the stream.
 * - `admission_timeout`: no response headers within min(15 s, D − now). The transport aborted the
 *   call ("deadline: admission").
 * - `budget_exhausted`: what was left of D could not cover ACR's minimum wait budget. Nothing was
 *   sent.
 * - `invalid_upstream`: the stream broke the event grammar or a cap before a valid terminal. The
 *   transport aborted it.
 * - `authorization_required`: no token for this call, and no way to one from here: a background
 *   read, which never starts the silent step (P1-6), an ACR client that is off, or a second 401.
 * - `authorization_failed`, `authorization_limited`, `not_entitled`, `impersonating` and
 *   `session_ended`: the silent step ran (CHAOS-12474) and gave no token, for that reason. Nothing
 *   ran. Only the first two can be helped by the user's next act, and nothing here tries again.
 *   `session_ended` has already gone to the normal sign-in.
 *
 * On a 401 the transport tells the store, reads the token once more, makes one silent attempt when
 * that gives no other token, and sends the call once more only with a different token: at most 2
 * requests (CHAOS-12305, CHAOS-12474).
 *
 * The browser's abort is a disconnect, and a disconnect ends ACR's run (plan §2.7.4), so the store
 * ends the turn with the reason and does not poll the submission status.
 */
export const TRANSPORT_FAILURE_REASONS = [
    "stalled",
    "admission_timeout",
    "budget_exhausted",
    "invalid_upstream",
    "authorization_required",
    "authorization_failed",
    "authorization_limited",
    "not_entitled",
    "impersonating",
    "session_ended",
] as const;

export type TransportFailureReason = (typeof TRANSPORT_FAILURE_REASONS)[number];

export function isTransportFailureReason(value: unknown): value is TransportFailureReason {
    return (TRANSPORT_FAILURE_REASONS as readonly unknown[]).includes(value);
}

/** The browser transport ended the run itself, for `reason`. */
export class TransportFailure extends Error {
    readonly reason: TransportFailureReason;

    constructor(reason: TransportFailureReason) {
        super(`the Ask Dev transport ended the run: ${reason}`);
        this.name = "TransportFailure";
        this.reason = reason;
    }
}

/**
 * ACR's answer to Stop (CHAOS-11957; acr `ContextFabricSubmissionCancelHandler`):
 *
 * - `running` (202): ACR recorded the cancel request (`t_req` is ACR's). The run ends on its own
 *   terminal: `canceled`, or a result that finished first.
 * - `final` (204): the submission is no longer running (done, done_unsaved or abandoned).
 * - `not_leased` (409 `submission_in_progress`, `details.reason: not_leased`): the run has no lease,
 *   so the cancel endpoint cannot stop it. Only the connection that owns it can (a disconnect).
 */
export type CancelAnswer =
    | { readonly kind: "running" }
    | { readonly kind: "final" }
    | { readonly kind: "not_leased"; readonly retryAfterSeconds?: number | undefined };
