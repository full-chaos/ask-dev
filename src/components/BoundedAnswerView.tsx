import { useId } from "react";

import { AnswerText } from "./AnswerPanel";
import { Badge } from "./Badge";
import { ClarificationView } from "./ClarificationPanel";
import { DriverCard, StrongestPressures } from "./DriversPanel";
import { LimitationsPanel } from "./LimitationsPanel";
import { RichShape } from "./RichShape";
import { ScalarFactsPanel } from "./ScalarFactsPanel";
import { VocabularyLabelsContext } from "./VocabularyWordContext";
import type { AnswerProjection, ClaimedFact, RenderShape } from "../lib/contracts";
import { identityLimitations } from "../lib/fact-dedup";
import {
    OMISSION_COUNTS,
    type OmissionCount,
    type ProjectionBudget,
} from "../lib/projection-budget";
import { statusTone } from "../lib/presentation";
import { answerStatusWord } from "../lib/vocabulary-labels";

/**
 * ACR's bounded answer (`context_fabric_answer_projection.v1`, CHAOS-12559): the answer ACR serves
 * when the whole result is over the caller's byte option. The projection selects and drops; it
 * never rewords. So this view draws it with the whole answer's own parts (`ClarificationView`,
 * `AnswerText`, `StrongestPressures`, `DriverCard`, `ScalarFactsPanel`, `RichShape`,
 * `LimitationsPanel`), under the
 * words ACR served for it, and adds only what the whole answer has no part for: the line that says
 * what was left out, from `projection_budget`'s counts. Completeness is not drawn (CHAOS-12245).
 */
export type BoundedAnswerViewProps = { readonly projection: AnswerProjection };

/** What one count names, in the sentence that says what was left out. */
const NOUNS: Readonly<Record<OmissionCount, readonly [string, string]>> = {
    drivers_omitted: ["driver", "drivers"],
    withheld_drivers_omitted: ["withheld driver", "withheld drivers"],
    cohort_members_omitted: ["member", "members"],
    cohort_groups_omitted: ["group", "groups"],
    facts_omitted: ["fact", "facts"],
    candidates_omitted: ["option", "options"],
    evidence_refs_omitted: ["evidence reference", "evidence references"],
    limitations_omitted: ["limitation", "limitations"],
    warnings_omitted: ["warning", "warnings"],
    coverage_omitted: ["coverage line", "coverage lines"],
    reasons_omitted: ["reason", "reasons"],
    render_shapes_omitted: ["chart", "charts"],
};

const ASK_NARROWER = "Ask about a narrower scope to see more.";

/**
 * The sentence that says this answer was shortened, and what it left out, from the counts alone.
 * A value ACR shortened (`values_clamped`) is disclosed like an omission, as ACR's contract says.
 * `undefined` when nothing was left out or shortened and the whole result was not withheld. The
 * classifier refuses a budget whose `truncated` contradicts its counts (`budgetIsConsistent`), so
 * the counts are the whole story here.
 */
export function leftOutSentence(budget: ProjectionBudget): string | undefined {
    const parts: string[] = [];
    for (const key of OMISSION_COUNTS) {
        const count = budget[key] ?? 0;
        const [one, many] = NOUNS[key];
        if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
    }
    const clamped = budget.values_clamped ?? 0;
    const clauses: string[] = [];
    if (parts.length > 0) {
        const list =
            parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
        clauses.push(`${list} left out`);
    }
    if (clamped > 0) clauses.push(`${clamped} ${clamped === 1 ? "value" : "values"} shortened`);
    if (clauses.length === 0) {
        return budget.full_result_omitted
            ? `This answer was shortened to fit. ${ASK_NARROWER}`
            : undefined;
    }
    return `This answer was shortened to fit: ${clauses.join("; ")}. ${ASK_NARROWER}`;
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
    const limitations = identityLimitations(projection.limitations);
    const limitationsOmitted = (projection.projection_budget.limitations_omitted ?? 0) > 0;
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
                {projection.clarification !== undefined ? (
                    // A clarification in bounded form: its prompt and the options it kept, drawn by
                    // the clarification panel's own body. No choice is offered: re-asking from a
                    // projection's receipts is not proved, so the panel says it cannot choose here.
                    <ClarificationView
                        candidates={projection.clarification.candidates}
                        evidenceRefLabels={projection.evidence_ref_labels}
                        prompt={projection.clarification.prompt}
                        reason={undefined}
                        resultId={projection.result_id}
                    />
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
                {shapes.length > 0 ? (
                    <section aria-label="Charts" className="panel" role="group">
                        {shapes.map((shape) => (
                            <RichShape key={shape.shape_id} shape={shape} />
                        ))}
                    </section>
                ) : null}
                {limitations.length > 0 || projection.warnings.length > 0 || !limitationsOmitted ? (
                    <LimitationsPanel
                        limitations={limitations}
                        limitationsOmitted={limitationsOmitted}
                        warnings={projection.warnings}
                    />
                ) : null}
            </section>
        </VocabularyLabelsContext.Provider>
    );
}
