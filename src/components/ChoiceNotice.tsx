import type { ChoiceDisposition } from "../lib/clarification";
import type { SubjectRef } from "../lib/contracts";
import { subjectKindNoun } from "../render/answer-copy";

export type ChoiceNoticeProps = {
    readonly chosen: SubjectRef;
    readonly disposition: ChoiceDisposition;
};

/**
 * Says that a clarification choice was not applied.
 *
 * Rendered in BOTH result shapes, which is the whole point:
 *
 *  - an answer about some other subject would otherwise read as an answer about
 *    the chosen one;
 *  - another clarification would otherwise read as an ordinary second
 *    clarification — and since it may offer the same candidates, a tester could
 *    choose, be asked again, choose again, and loop, with the Workbench looking
 *    correct the entire time.
 *
 * Detection only. It offers no retry, because a measurement instrument that
 * re-rolls until something works hides the rate it exists to read.
 */
export function ChoiceNotice({ chosen, disposition }: ChoiceNoticeProps) {
    if (disposition.applied) return null;

    return (
        <section className="panel panel--failure" aria-label="Choice not applied" role="alert">
            <h2 className="panel__title">Your choice was not applied</h2>
            <p className="answer__judgment">
                {disposition.answered
                    ? `This answer is NOT about ${chosen.label}. Ask Dev did not settle on that subject, so the result below concerns something else.`
                    : `Ask Dev did not settle on ${chosen.label} and is asking again. Choosing the same candidate is likely to repeat this.`}
            </p>
            <p className="record__meta">
                chosen: {chosen.label} · {subjectKindNoun(chosen.kind)}
            </p>
            <p className="record__meta">
                Ask Dev can drop a choice without saying so: the earlier answer may be unreadable,
                the choice may match no candidate, or the subject may be outside what you can read.
                It appears that happened here. Nothing was retried.
            </p>
        </section>
    );
}
