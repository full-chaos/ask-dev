import type { ReactNode } from "react";

import {
    CHAT_PROGRESS_COPY,
    CHAT_STATUS_COPY,
    chatStatusWords,
    retryAfterText,
} from "../../render/chat-copy";
import type { ChatStatus } from "../../render/source";

export type ChatStatusPanelProps = {
    readonly status: ChatStatus;
    /** The outcome's `retry`. `failed` words itself by it. */
    readonly retry: boolean;
    /**
     * Present only for the latest turn whose status may be sent again and whose ask was plain (the
     * same availability rule `FailurePanel`'s `onRetry` follows). Absent on frozen turns.
     */
    readonly onRetry?: (() => void) | undefined;
    /** Present only on a `restore_failed` turn of a source that offers `reloadTurn`. */
    readonly onReload?: (() => void) | undefined;
    readonly pending?: boolean | undefined;
    /** The host's Connect affordance, after the words. The caller passes it for `connect` only. */
    readonly connect?: ReactNode;
};

/**
 * A turn that ended without an answer for a reason a host source names (CHAOS-12382): a deadline,
 * a limit, a lost stream, a closed thread. It says what happened in web's words and, where the
 * source allows, offers the same Retry `FailurePanel` offers. It is not a failure panel: nothing
 * here is a Workbench-worded error, and no answer is implied.
 */
export function ChatStatusPanel({
    status,
    retry,
    onRetry,
    onReload,
    pending = false,
    connect,
}: ChatStatusPanelProps) {
    const reference =
        status.kind === "failed" || status.kind === "mismatch" ? status.reference : undefined;
    const lastSeen = status.kind === "unconfirmed" ? status.lastSeenRunningAt : undefined;
    return (
        <section className="chat__status" data-status={status.kind} data-testid="chat-status">
            <p className="chat__status-words">{chatStatusWords(status, retry)}</p>
            {lastSeen === undefined ? null : (
                <p className="chat__status-meta" data-testid="chat-status-last-seen">
                    {CHAT_PROGRESS_COPY.lastSeenRunning}{" "}
                    {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
                        new Date(lastSeen),
                    )}
                </p>
            )}
            {status.kind === "limited" && status.retryAfterSeconds !== undefined ? (
                <p className="chat__status-meta" data-testid="chat-status-retry-after">
                    {retryAfterText(status.retryAfterSeconds)}
                </p>
            ) : null}
            {reference === undefined ? null : (
                <p className="chat__status-meta" data-testid="chat-status-reference">
                    {CHAT_STATUS_COPY.reference}: <code>{reference}</code>
                </p>
            )}
            {connect === undefined || connect === null ? null : (
                <div className="chat__status-slot">{connect}</div>
            )}
            {onRetry === undefined ? null : (
                <button
                    className="question-form__submit"
                    disabled={pending}
                    onClick={onRetry}
                    style={{ marginTop: 10 }}
                    type="button"
                >
                    {pending ? "Retrying…" : "Retry"}
                </button>
            )}
            {onReload === undefined ? null : (
                <button
                    className="question-form__submit"
                    onClick={onReload}
                    style={{ marginTop: 10 }}
                    type="button"
                >
                    {CHAT_STATUS_COPY.loadAgain}
                </button>
            )}
        </section>
    );
}
