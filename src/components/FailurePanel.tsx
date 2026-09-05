import { NarrowerReask } from "@/components/NarrowerReask";
import { SafeAnswerText } from "@/components/SafeAnswerText";
import { isBlankQuestion } from "@/lib/acr/narrower-continuation-copy";
import type { WorkbenchFailure } from "@/lib/acr/errors";

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
 * The Workbench exists to prove answer quality, so a failure must never be
 * dressed up as a thin answer. This panel names the upstream code and status
 * and, where the cause is an operator state rather than a transient blip, says
 * what has to be true for the call to succeed.
 */
export function FailurePanel({
    failure,
    onRetry,
    originalQuestion,
    onNarrowerReask,
    pending = false,
}: FailurePanelProps) {
    return (
        <section className="panel panel--failure" aria-labelledby="failure-title" role="alert">
            <h2 className="panel__title" id="failure-title">
                No answer
            </h2>
            <p className="answer__judgment">
                <SafeAnswerText text={failure.message} />
            </p>
            <p className="record__meta">
                {failure.code}
                {failure.httpStatus === undefined ? "" : ` · HTTP ${failure.httpStatus}`}
                {failure.upstreamCode === undefined ? "" : ` · ${failure.upstreamCode}`}
                {failure.retryable ? " · retryable" : " · not retryable"}
            </p>
            {failure.upstreamRequestId === undefined ? null : (
                <p className="record__meta">
                    ACR request id <code>{failure.upstreamRequestId}</code> — quote this to match
                    the failure against ACR&apos;s own logs.
                </p>
            )}
            {failure.details !== undefined && failure.details.length > 0 ? (
                <ul className="stack stack--tight" style={{ marginTop: 10 }}>
                    {failure.details.map((detail) => (
                        <li className="record" key={detail}>
                            <code>{detail}</code>
                        </li>
                    ))}
                </ul>
            ) : null}
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
            {failure.narrowerContinuation === undefined ||
            onNarrowerReask === undefined ||
            originalQuestion === undefined ||
            isBlankQuestion(originalQuestion) ? null : (
                <NarrowerReask
                    maxItems={failure.maxItems}
                    measuredItems={failure.measuredItems}
                    narrowerContinuation={failure.narrowerContinuation}
                    onReask={onNarrowerReask}
                    originalQuestion={originalQuestion}
                    overrun={failure.overrun}
                    pending={pending}
                />
            )}
        </section>
    );
}
