"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { CTA_LABELS, FEEDBACK_COPY } from "../../render/chat-copy";
import {
    FEEDBACK_QUESTIONS,
    type ChatFeedbackEntry,
    type ChatFeedbackSource,
    type FeedbackQuestion,
} from "../../render/source";

export type ChatFeedbackProps = {
    readonly feedback: ChatFeedbackSource;
    readonly resultId: string;
};

function sameEntry(a: ChatFeedbackEntry, b: ChatFeedbackEntry): boolean {
    return (
        a.state === b.state &&
        a.saving === b.saving &&
        a.notSaved === b.notSaved &&
        FEEDBACK_QUESTIONS.every((question) => a.desired[question] === b.desired[question])
    );
}

/**
 * A snapshot reader that keeps the last entry while the next one is equal. React's store hook loops
 * on a new object per read, so a host that builds its entry on every read must not stop the render.
 */
function entryReader(feedback: ChatFeedbackSource, resultId: string) {
    let last: ChatFeedbackEntry | undefined;
    return () => {
        const next = feedback.entryFor(resultId);
        if (next === undefined || last === undefined || !sameEntry(last, next)) last = next;
        return last;
    };
}

/**
 * Feedback on one answer: "Correct?" and "Useful?", each yes or no. Pressing the chosen value again
 * clears it, and that is the store's job, so a press only names the value. Ported from web's
 * `AskDevFeedback`, with its words, test ids and rules.
 *
 * - An `unavailable` entry, or none yet, renders nothing.
 * - While the first read is out, the controls are drawn disabled. A failed read keeps them disabled,
 *   with "Try again" (a GET).
 * - A failed write says "Feedback was not saved."
 * - There is no free text, and nothing here sends telemetry or logs a choice.
 */
export function ChatFeedback({ feedback, resultId }: ChatFeedbackProps) {
    // Called through the source (never detached), so a source whose methods read `this` still works.
    const subscribe = useCallback(
        (listener: () => void) => feedback.subscribe(listener),
        [feedback],
    );
    const readEntry = useMemo(() => entryReader(feedback, resultId), [feedback, resultId]);
    const entry = useSyncExternalStore(subscribe, readEntry, () => undefined);
    const ready = useSyncExternalStore(
        subscribe,
        () => feedback.isReady(),
        () => false,
    );
    useEffect(() => {
        if (ready && entry === undefined) feedback.ensure(resultId);
    }, [feedback, resultId, ready, entry]);
    if (entry === undefined || entry.state === "unavailable") return null;
    return (
        // A named group, not a landmark: a conversation has one per answer, and landmarks must be
        // unique.
        <div
            aria-busy={entry.state === "loading" || entry.saving}
            aria-label={FEEDBACK_COPY.region}
            className="chat-feedback"
            data-state={entry.state}
            data-testid="ask-dev-feedback"
            role="group"
        >
            {FEEDBACK_QUESTIONS.map((question) => (
                <FlagGroup
                    enabled={entry.state === "ready"}
                    entry={entry}
                    key={question}
                    onChoose={(value) => {
                        feedback.choose(resultId, question, value);
                    }}
                    question={question}
                />
            ))}
            {entry.state === "read_failed" ? (
                <p
                    className="chat-feedback__note"
                    data-testid="ask-dev-feedback-read-failed"
                    role="status"
                >
                    {FEEDBACK_COPY.readFailed}
                    <button
                        className="chat__link-button"
                        data-testid="ask-dev-feedback-retry"
                        onClick={() => {
                            feedback.retryRead(resultId);
                        }}
                        type="button"
                    >
                        {CTA_LABELS.tryAgain}
                    </button>
                </p>
            ) : null}
            {entry.notSaved ? (
                <p
                    className="chat-feedback__note"
                    data-testid="ask-dev-feedback-not-saved"
                    role="status"
                >
                    {FEEDBACK_COPY.notSaved}
                </p>
            ) : null}
        </div>
    );
}

function FlagGroup({
    question,
    entry,
    enabled,
    onChoose,
}: {
    readonly question: FeedbackQuestion;
    readonly entry: ChatFeedbackEntry;
    readonly enabled: boolean;
    readonly onChoose: (value: "yes" | "no") => void;
}) {
    const label = FEEDBACK_COPY[question];
    const chosen = entry.desired[question];
    return (
        <div
            aria-label={label}
            className="chat-feedback__group"
            data-testid={`ask-dev-feedback-${question}`}
            role="group"
        >
            <span aria-hidden="true" className="chat-feedback__label">
                {label}
            </span>
            {(["yes", "no"] as const).map((value) => {
                const on = chosen === value;
                return (
                    <button
                        aria-pressed={on}
                        className={
                            on
                                ? "chat-feedback__choice chat-feedback__choice--on"
                                : "chat-feedback__choice"
                        }
                        data-testid={`ask-dev-feedback-${question}-${value}`}
                        disabled={!enabled}
                        key={value}
                        onClick={() => {
                            onChoose(value);
                        }}
                        type="button"
                    >
                        {on ? (
                            <svg
                                aria-hidden="true"
                                fill="none"
                                height="14"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2.5"
                                viewBox="0 0 24 24"
                                width="14"
                            >
                                <path d="M20 6 9 17l-5-5" />
                            </svg>
                        ) : null}
                        {FEEDBACK_COPY[value]}
                    </button>
                );
            })}
        </div>
    );
}
