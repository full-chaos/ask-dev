import { useId } from "react";

import { NarrowerReask } from "./NarrowerReask";
import { SafeAnswerText } from "./SafeAnswerText";
import { isBudgetRefusal, REFUSAL_COPY } from "../lib/acr/narrower-continuation-copy";
import type { WorkbenchFailure } from "../lib/acr/errors";
import { CHAT_STATUS_COPY } from "../render/chat-copy";

export type FailurePanelProps = {
    readonly failure: WorkbenchFailure;
    /**
     * Present only for the latest turn's own plain (no receipt/subject/
     * structure) ask — a re-ask that carried a chosen subject or structure
     * batch is NOT retried from here, so this component never re-derives
     * that receipt logic. Absent elsewhere, including on frozen turns.
     */
    readonly onRetry?: (() => void) | undefined;
    /**
     * CHAOS-5107: the tester's own original question text, needed to build
     * the narrower re-ask (`@/components/NarrowerReask`). Same availability
     * rule as `onRetry` above — only the latest turn's own plain ask carries
     * one — but gated independently: a 413 budget refusal is NOT retryable
     * (`onRetry` never fires for it), yet IS narrower-reaskable, which is the
     * whole point of this component.
     */
    readonly originalQuestion?: string | undefined;
    readonly onNarrowerReask?: ((narrowedQuestion: string) => void) | undefined;
    readonly pending?: boolean | undefined;
};

/**
 * Reports a failure as a failure.
 *
 * A failure must never be dressed up as a thin answer, so this panel says what
 * happened in product words and, where the cause is an operator state rather
 * than a transient blip, what has to be true for the call to succeed.
 *
 * CHAOS-12406: no code, status or internal name reaches a user, on any surface:
 * the failure's class stays in `data-*` for tests, and the request id is the one
 * handle shown. A budget refusal reads in web's words, with the panel's body in
 * `NarrowerReask`.
 */
export function FailurePanel({
    failure,
    onRetry,
    originalQuestion,
    onNarrowerReask,
    pending = false,
}: FailurePanelProps) {
    // One per failed turn: a transcript can hold several, each named by its own heading.
    const titleId = useId();
    const budgetRefusal = isBudgetRefusal(failure);
    return (
        <section
            className="panel panel--failure"
            aria-labelledby={titleId}
            data-axis={budgetRefusal ? (failure.narrowerContinuation?.axis ?? "none") : undefined}
            data-failure-code={failure.code}
            data-kind={budgetRefusal ? "budget" : "other"}
            data-retryable={failure.retryable}
            data-testid="ask-dev-refusal"
            role="alert"
        >
            <h2 className="panel__title" id={titleId}>
                {budgetRefusal ? REFUSAL_COPY.status : "No answer"}
            </h2>
            <p className="answer__judgment">
                <SafeAnswerText text={budgetRefusal ? REFUSAL_COPY.lead : failure.message} />
            </p>
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
            {budgetRefusal ? (
                <NarrowerReask
                    maxBytes={failure.maxBytes}
                    maxItems={failure.maxItems}
                    measuredBytes={failure.measuredBytes}
                    measuredItems={failure.measuredItems}
                    narrowerContinuation={failure.narrowerContinuation}
                    nothingLeftToCut={failure.nothingLeftToCut}
                    onReask={onNarrowerReask}
                    originalQuestion={originalQuestion}
                    overrun={failure.overrun}
                    pending={pending}
                    retryable={failure.retryable}
                />
            ) : null}
            {failure.upstreamRequestId === undefined ? null : (
                <p className="record__meta" data-testid="failure-reference">
                    {CHAT_STATUS_COPY.reference}: <code>{failure.upstreamRequestId}</code>
                </p>
            )}
        </section>
    );
}
