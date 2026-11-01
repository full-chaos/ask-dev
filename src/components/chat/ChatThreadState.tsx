import type { ReactNode } from "react";

import { CTA_LABELS, TRANSCRIPT_COPY } from "../../render/chat-copy";
import type { ChatThreadAccess } from "../../render/source";

/** A thread the render cannot show: no turn of it is drawn, and it takes no question. */
export type NotShownThread = Extract<
    ChatThreadAccess,
    { kind: "unavailable" | "read_failed" | "connect" }
>;

export function isNotShownThread(thread: ChatThreadAccess | undefined): thread is NotShownThread {
    return (
        thread?.kind === "unavailable" ||
        thread?.kind === "read_failed" ||
        thread?.kind === "connect"
    );
}

function NewConversationButton({ onNew }: { readonly onNew: () => void }) {
    return (
        <button
            className="chat__action"
            data-testid="ask-dev-conversation-new"
            onClick={onNew}
            type="button"
        >
            {CTA_LABELS.askDevNewConversation}
        </button>
    );
}

export type ChatThreadNotShownProps = {
    readonly kind: NotShownThread["kind"];
    readonly onNew: () => void;
    /** Present when the source can read the thread again. `read_failed` only. */
    readonly onRetry?: (() => void) | undefined;
    /** The host's Connect affordance, called for `connect` only. */
    readonly renderConnect: () => ReactNode;
};

/**
 * The read-only state of a conversation that cannot be shown: one that is not served (no cause is
 * named), one that could not be read, or one the host holds no access for (Connect, no Try again).
 * Ported from web's `ConversationNotShown`, with its words and test ids.
 */
export function ChatThreadNotShown({
    kind,
    onNew,
    onRetry,
    renderConnect,
}: ChatThreadNotShownProps) {
    if (kind === "connect") {
        return (
            <section className="chat__status" data-testid="ask-dev-conversation-connect">
                <p className="chat__status-words">{TRANSCRIPT_COPY.connect}</p>
                <div className="chat__status-actions">
                    {renderConnect()}
                    <NewConversationButton onNew={onNew} />
                </div>
            </section>
        );
    }
    const failed = kind === "read_failed";
    return (
        <section
            className="chat__status"
            data-testid={
                failed ? "ask-dev-conversation-read-failed" : "ask-dev-conversation-unavailable"
            }
        >
            <p className="chat__status-words">
                {failed ? TRANSCRIPT_COPY.readFailed : TRANSCRIPT_COPY.unavailable}
            </p>
            {failed ? null : <p className="chat__status-meta">{TRANSCRIPT_COPY.unavailableHint}</p>}
            <div className="chat__status-actions">
                {failed && onRetry !== undefined ? (
                    <button
                        className="chat__action"
                        data-testid="ask-dev-conversation-retry"
                        onClick={onRetry}
                        type="button"
                    >
                        {CTA_LABELS.tryAgain}
                    </button>
                ) : null}
                <NewConversationButton onNew={onNew} />
            </div>
        </section>
    );
}

export type ChatEarlierTurnsProps = {
    readonly earlier: "available" | "loading" | "failed";
    readonly onLoad: () => void;
};

/** "Show earlier turns" above the oldest turn shown, while the host has earlier ones. */
export function ChatEarlierTurns({ earlier, onLoad }: ChatEarlierTurnsProps) {
    return (
        <div className="chat__earlier" data-testid="ask-dev-earlier-turns">
            {earlier === "failed" ? (
                <p className="chat__status-meta">{TRANSCRIPT_COPY.earlierFailed}</p>
            ) : null}
            <button
                className="chat__action"
                data-testid="ask-dev-show-earlier"
                disabled={earlier === "loading"}
                onClick={onLoad}
                type="button"
            >
                {CTA_LABELS.askDevShowEarlierTurns}
            </button>
        </div>
    );
}

/** A reload lost this tab's conversation: said instead of the empty prompt. */
export function ChatNotSavedNotice() {
    return (
        <section className="chat__status" data-testid="ask-dev-not-saved">
            <p className="chat__status-words">{TRANSCRIPT_COPY.notSaved}</p>
            <p className="chat__status-meta">{TRANSCRIPT_COPY.notSavedHint}</p>
        </section>
    );
}
