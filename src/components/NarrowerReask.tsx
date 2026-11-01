import {
    describeBudgetOverrun,
    isBlankQuestion,
    NARROWER_REASK_PENDING_LABEL,
    narrowerContinuationCopy,
    REFUSAL_COPY,
} from "../lib/acr/narrower-continuation-copy";
import type { WorkbenchFailure } from "../lib/acr/errors";
import { SafeAnswerText } from "./SafeAnswerText";

export type NarrowerReaskProps = {
    /** Absent when ACR named no axis: nothing narrower can be suggested. */
    readonly narrowerContinuation?: WorkbenchFailure["narrowerContinuation"];
    readonly overrun?: WorkbenchFailure["overrun"];
    readonly measuredItems?: WorkbenchFailure["measuredItems"];
    readonly maxItems?: WorkbenchFailure["maxItems"];
    readonly measuredBytes?: WorkbenchFailure["measuredBytes"];
    readonly maxBytes?: WorkbenchFailure["maxBytes"];
    readonly nothingLeftToCut?: WorkbenchFailure["nothingLeftToCut"];
    /** Whether the same question may be sent again. Absent: not. */
    readonly retryable?: boolean;
    /**
     * The tester's own original question text — never a corpus/fixture question. Absent, or blank:
     * no re-ask is offered, and the refusal's words still stand.
     */
    readonly originalQuestion?: string | undefined;
    /** Called with the narrowed question text; the caller resubmits it. Absent: no re-ask. */
    readonly onReask?: ((narrowedQuestion: string) => void) | undefined;
    readonly pending?: boolean;
};

/**
 * What a budget refusal says below its lead, in web's words: what did not fit as measured, whether
 * asking again helps, and the narrower question ACR's axis points to (CHAOS-12406). On the latest
 * plain ask it adds CHAOS-4735's planned-refusal continuation as a one-click narrower re-ask.
 *
 * The axis/family the engine names are structural claims; every word shown
 * here is client-authored (`@/lib/acr/narrower-continuation-copy`), and the
 * re-ask question is the tester's OWN question with a client-authored clause
 * appended — never a corpus question (E-6, chris).
 */
export function NarrowerReask({
    narrowerContinuation,
    overrun,
    measuredItems,
    maxItems,
    measuredBytes,
    maxBytes,
    nothingLeftToCut = false,
    retryable = false,
    originalQuestion,
    onReask,
    pending = false,
}: NarrowerReaskProps) {
    const copy =
        narrowerContinuation === undefined
            ? undefined
            : narrowerContinuationCopy[narrowerContinuation.axis];
    const overrunSentence = describeBudgetOverrun({
        overrun,
        measuredItems,
        maxItems,
        measuredBytes,
        maxBytes,
    });
    const narrowedQuestion =
        copy === undefined || originalQuestion === undefined || isBlankQuestion(originalQuestion)
            ? undefined
            : copy.narrowQuestion(originalQuestion);

    return (
        <div className="narrower-reask" style={{ marginTop: 10 }}>
            {overrunSentence === undefined ? null : (
                <p className="record__meta" data-testid="ask-dev-refusal-overrun">
                    <SafeAnswerText text={overrunSentence} />
                    {nothingLeftToCut ? ` ${REFUSAL_COPY.nothingLeftToCut}` : null}
                </p>
            )}
            {retryable ? null : <p className="record__meta">{REFUSAL_COPY.sameAgain}</p>}
            <p className="record__meta" data-testid="ask-dev-refusal-narrower">
                <SafeAnswerText text={copy?.explanation ?? REFUSAL_COPY.noAxis} />
            </p>
            {copy === undefined ||
            narrowedQuestion === undefined ||
            onReask === undefined ? null : (
                <button
                    className="question-form__submit"
                    data-testid="ask-dev-refusal-reask"
                    disabled={pending}
                    onClick={() => {
                        onReask(narrowedQuestion);
                    }}
                    style={{ marginTop: 10 }}
                    type="button"
                >
                    {pending ? NARROWER_REASK_PENDING_LABEL : copy.actionLabel}
                </button>
            )}
        </div>
    );
}
