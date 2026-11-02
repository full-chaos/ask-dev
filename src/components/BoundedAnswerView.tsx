import { useId } from "react";

import { AnswerText } from "./AnswerPanel";
import { Badge } from "./Badge";
import { DriverCard, StrongestPressures } from "./DriversPanel";
import { LimitationsPanel } from "./LimitationsPanel";
import { RichShape } from "./RichShape";
import { ScalarFactsPanel } from "./ScalarFactsPanel";
import { VocabularyLabelsContext } from "./VocabularyWordContext";
import type { AnswerProjection, ClaimedFact, RenderShape } from "../lib/contracts";
import { identityLimitations } from "../lib/fact-dedup";
import { statusTone } from "../lib/presentation";
import { answerStatusWord } from "../lib/vocabulary-labels";

/**
 * ACR's bounded answer (`context_fabric_answer_projection.v1`, CHAOS-12559): the answer ACR serves
 * when the whole result is over the caller's byte option. The projection selects and drops; it
 * never rewords. So this view draws it with the whole answer's own parts (`AnswerText`,
 * `StrongestPressures`, `DriverCard`, `ScalarFactsPanel`, `RichShape`, `LimitationsPanel`), under the
 * words ACR served for it, and adds only what the whole answer has no part for: the line that says
 * what was left out, from `projection_budget`'s counts. Completeness is not drawn (CHAOS-12245).
 */
export type BoundedAnswerViewProps = { readonly projection: AnswerProjection };

type ProjectionBudget = AnswerProjection["projection_budget"];

/** What one count names, in the sentence that says what was left out. */
const LEFT_OUT: readonly (readonly [keyof ProjectionBudget, string, string])[] = [
    ["drivers_omitted", "driver", "drivers"],
    ["withheld_drivers_omitted", "withheld driver", "withheld drivers"],
    ["cohort_members_omitted", "member", "members"],
    ["cohort_groups_omitted", "group", "groups"],
    ["facts_omitted", "fact", "facts"],
    ["candidates_omitted", "option", "options"],
    ["evidence_refs_omitted", "evidence reference", "evidence references"],
    ["limitations_omitted", "limitation", "limitations"],
    ["warnings_omitted", "warning", "warnings"],
    ["coverage_omitted", "coverage line", "coverage lines"],
    ["reasons_omitted", "reason", "reasons"],
    ["render_shapes_omitted", "chart", "charts"],
];

/**
 * The sentence that says this answer was shortened, and what it left out, from the counts alone.
 * `undefined` when nothing was left out and the whole result was not withheld.
 */
export function leftOutSentence(budget: ProjectionBudget): string | undefined {
    const parts: string[] = [];
    for (const [key, one, many] of LEFT_OUT) {
        const count = budget[key];
        if (typeof count === "number" && count > 0)
            parts.push(`${count} ${count === 1 ? one : many}`);
    }
    if (parts.length === 0) {
        return budget.full_result_omitted
            ? "This answer was shortened to fit. Ask about a narrower scope to see more."
            : undefined;
    }
    const list =
        parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    return `This answer was shortened to fit: ${list} left out. Ask about a narrower scope to see more.`;
}

/**
 * The projection's facts with a value and no rows, as the whole answer's fact table reads them. A
 * fact with rows is drawn by its chart, when the projection kept one; a fact with no value has
 * nothing for a table cell.
 */
function scalarFactsOf(projection: AnswerProjection): readonly ClaimedFact[] {
    return projection.key_facts.flatMap((fact) =>
        fact.value === undefined ||
        (fact.rows?.length ?? 0) > 0 ||
        (fact.time_series_rows?.length ?? 0) > 0
            ? []
            : [
                  {
                      claim_id: fact.claim_id,
                      kind: fact.kind,
                      subject: fact.subject,
                      field: fact.field,
                      value: fact.value,
                  },
              ],
    );
}

const NO_FOOTNOTES: ReadonlySet<string> = new Set();

export function BoundedAnswerView({ projection }: BoundedAnswerViewProps) {
    const idPrefix = useId();
    const status = answerStatusWord(projection);
    const leftOut = leftOutSentence(projection.projection_budget);
    const facts = scalarFactsOf(projection);
    const shapes: readonly RenderShape[] = projection.render_shapes ?? [];
    const drivers = projection.principal_drivers;
    return (
        <VocabularyLabelsContext.Provider value={projection.vocabulary_labels}>
            <section aria-label="Shortened answer" className="answer bounded-answer">
                {status !== undefined ? (
                    <Badge tone={statusTone(projection.status)}>{status}</Badge>
                ) : null}
                {leftOut !== undefined ? (
                    <p className="record__meta bounded-answer__left-out" role="note">
                        {leftOut}
                    </p>
                ) : null}
                <section
                    aria-labelledby={`${idPrefix}-answer-title`}
                    className="panel"
                    data-testid="answer-panel"
                    role="group"
                >
                    <h2 className="panel__title" id={`${idPrefix}-answer-title`}>
                        Answer
                    </h2>
                    <AnswerText
                        currentState={projection.current_state}
                        deterministicAnswer={projection.deterministic_answer}
                        directJudgment={projection.direct_judgment}
                    />
                </section>
                {drivers.length > 0 || projection.strongest_pressures.length > 0 ? (
                    <section
                        aria-labelledby={`${idPrefix}-drivers-title`}
                        className="panel panel--card"
                        data-testid="drivers-panel"
                        role="group"
                    >
                        <h2 className="panel__title" id={`${idPrefix}-drivers-title`}>
                            Drivers
                        </h2>
                        <StrongestPressures pressures={projection.strongest_pressures} />
                        <ul className="stack">
                            {drivers.map((driver) => (
                                <DriverCard
                                    claims={facts}
                                    driver={driver}
                                    evidenceRefLabels={projection.evidence_ref_labels}
                                    key={driver.driver_id}
                                    membersWithFootnote={NO_FOOTNOTES}
                                    paths={[]}
                                />
                            ))}
                        </ul>
                    </section>
                ) : null}
                <ScalarFactsPanel facts={facts} result={undefined} />
                {shapes.map((shape) => (
                    <RichShape key={shape.shape_id} shape={shape} />
                ))}
                <LimitationsPanel
                    limitations={identityLimitations(projection.limitations)}
                    warnings={projection.warnings}
                />
            </section>
        </VocabularyLabelsContext.Provider>
    );
}
