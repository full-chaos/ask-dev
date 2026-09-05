import {
    describeBudgetOverrun,
    NARROWER_REASK_PENDING_LABEL,
    narrowerContinuationCopy,
} from "@/lib/acr/narrower-continuation-copy";
import type { WorkbenchFailure } from "@/lib/acr/errors";
import { SafeAnswerText } from "@/components/SafeAnswerText";

export type NarrowerReaskProps = {
    readonly narrowerContinuation: NonNullable<WorkbenchFailure["narrowerContinuation"]>;
    readonly overrun?: WorkbenchFailure["overrun"];
    readonly measuredItems?: WorkbenchFailure["measuredItems"];
    readonly maxItems?: WorkbenchFailure["maxItems"];
    /** The tester's own original question text — never a corpus/fixture question. */
    readonly originalQuestion: string;
    /** Called with the narrowed question text; the caller resubmits it. */
    readonly onReask: (narrowedQuestion: string) => void;
    readonly pending?: boolean;
};

/**
 * Renders CHAOS-4735's planned-refusal continuation as a one-click narrower
 * re-ask.
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
    originalQuestion,
    onReask,
    pending = false,
}: NarrowerReaskProps) {
    const copy = narrowerContinuationCopy[narrowerContinuation.axis];
    const overrunSentence = describeBudgetOverrun({ overrun, measuredItems, maxItems });
    const narrowedQuestion = copy.narrowQuestion(originalQuestion);

    return (
        <div className="narrower-reask" style={{ marginTop: 10 }}>
            {overrunSentence === undefined ? null : (
                <p className="record__meta">
                    <SafeAnswerText text={overrunSentence} />
                </p>
            )}
            <p className="record__meta">
                <SafeAnswerText text={copy.explanation} />
            </p>
            <button
                className="question-form__submit"
                disabled={pending}
                onClick={() => {
                    onReask(narrowedQuestion);
                }}
                style={{ marginTop: 10 }}
                type="button"
            >
                {pending ? NARROWER_REASK_PENDING_LABEL : copy.actionLabel}
            </button>
        </div>
    );
}
