import { useId } from "react";

import type { AnswerPlan } from "@/lib/contracts";
import { humanizeTerm } from "@/lib/presentation";

export type AnswerPlanPanelProps = {
    readonly answerPlan: AnswerPlan | undefined;
};

/**
 * CHAOS-4636/CHAOS-4668: the plan a result was assembled against — what
 * question family the engine resolved, the budget it planned within, and any
 * narrowing steps it took to stay inside that budget.
 *
 * Per CHAOS-4668's own scope note ("render the new surfaces MINIMALLY... a
 * collapsed 'Plan' details block... is the right scope") this stays a single
 * collapsed `<details>`, same shape as `CoveragePanel`'s "Source details" —
 * apparatus, not a new lead panel (CHAOS-4669: answer leads, apparatus
 * collapses). `answer_plan` is schema-OPTIONAL (CHAOS-4656 doctrine), so this
 * renders nothing for any pre-S5 result — byte-identical to this component's
 * absence.
 *
 * `narrowing` is the "showing 2 of 3 teams, 3 of N projects each" disclosure
 * North Star checks 5 and 12 ask for: each step names its own before/after
 * counts and the basis it narrowed by, shown verbatim — never re-derived or
 * re-worded (README, "What this is").
 */
export function AnswerPlanPanel({ answerPlan }: AnswerPlanPanelProps) {
    const idPrefix = useId();
    if (answerPlan === undefined) return null;
    const narrowing = answerPlan.narrowing ?? [];
    return (
        <details className="disclosure" data-testid="answer-plan-panel">
            <summary id={`${idPrefix}-answer-plan-title`}>
                Plan — {humanizeTerm(answerPlan.family)}
            </summary>
            <div className="stack stack--tight">
                <p className="record__meta" data-testid="answer-plan-budget">
                    Budget: {answerPlan.budget.max_items} items · {answerPlan.budget.max_members}{" "}
                    members · {answerPlan.budget.max_serialized_bytes} bytes
                </p>
                {narrowing.length === 0 ? null : (
                    <ul className="stack stack--tight" data-testid="answer-plan-narrowing">
                        {narrowing.map((step, index) => (
                            <li className="record__meta" key={`${step.stage}-${index}`}>
                                {
                                    // Verbatim before/after, never re-derived —
                                    // same rule CohortRankingPanel's own
                                    // truncated notice follows.
                                }
                                Showing {step.after} of {step.before} at {humanizeTerm(step.stage)}{" "}
                                (by {humanizeTerm(step.basis)})
                                {step.overrun === undefined ? null : (
                                    <> — {humanizeTerm(step.overrun)}</>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </details>
    );
}
