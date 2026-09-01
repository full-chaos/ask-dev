import { useId } from "react";

import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { InvestigationResult } from "@/lib/contracts";
import { nonBlank } from "@/lib/presentation";

export type AnswerPanelProps = {
    readonly result: InvestigationResult;
};

/**
 * The answer as the service stated it — narrative prose only.
 *
 * CHAOS-4581: prose now reads AFTER the decision-carrying panels (ranked
 * teams / driver cards / coverage strip — see `DeterministicAnswerView`'s own
 * ordering comment). The one-line answer is NEVER hidden behind a click
 * (team-lead correction, 2026-08-30): `deterministic_answer` (the service's
 * own non-model wording) and `direct_judgment` (the judgment sentence, or an
 * explicit "no direct judgment" when the service sent none) are both always
 * visible. Only `current_state` — the field where a long fact dump tends to
 * land (CHAOS-4580 is shrinking that on the acr side) — sits behind a closed
 * `<details>`, so whatever prose arrives there never reintroduces a wall of
 * text between the panels and the fold. Nothing is summarized, reordered by
 * importance, or filled with the workbench's own words.
 * `strongest_pressures` and `drivers` moved out to `DriversPanel`
 * (CHAOS-4581) — a panel, not prose.
 *
 * CHAOS-4690/CHAOS-4691: `deterministic_answer`/`direct_judgment` used to
 * need a client-side arithmetic-sentence-splitting pass (`prose-detail.ts`)
 * because acr's own cohort recompose spliced a driver-scoring TEMPLATE sentence
 * ("readiness gap (weight 15, value 1.00) contributed 20.0 of ... attention
 * points.") into the lead prose (CHAOS-4669 defect 2, confirmed live). The
 * sibling engine ticket removed that splice AT THE SOURCE — cohort lead
 * recomposition now emits the status sentence alone, with the structured
 * driver numbers staying exactly where `DriversPanel` already renders them
 * — so there is nothing left to parse out of the field, and
 * `prose-detail.ts` is deleted rather than hardened (chris's strike-three
 * ruling on consumer-side text parsers). Both fields render in full, as
 * the service sent them; `current_state` is the only field that still folds
 * behind "More detail".
 */
export function AnswerPanel({ result }: AnswerPanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns and every later turn's
    // `aria-labelledby` resolved to the FIRST turn's heading.
    const idPrefix = useId();
    // Displayed text is COSMETICALLY trimmed (leading/trailing ASCII
    // whitespace only, matching the field's own pre-4691 display
    // convention) — a purely visual tidy-up, independent of the render
    // DECISION below, which routes through the same `nonBlank` predicate
    // every other blank-content judgment in this ticket's diff uses (team-
    // lead ruling, round 3 close-out: one swept predicate, not a
    // per-field `.trim() !== ""` reimplementation that would miss the
    // same zero-width/combining-mark categories `nonBlank` already
    // covers).
    const deterministicAnswer = result.deterministic_answer.trim();
    const directJudgment = result.direct_judgment.trim();
    const hasDeterministicAnswer = nonBlank(result.deterministic_answer) !== undefined;
    const hasJudgment = nonBlank(result.direct_judgment) !== undefined;
    const hasCurrentState = nonBlank(result.current_state) !== undefined;
    return (
        <section
            className="panel"
            aria-labelledby={`${idPrefix}-answer-title`}
            data-testid="answer-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-answer-title`}>
                Answer
            </h2>
            {hasDeterministicAnswer ? (
                <p className="answer__judgment">
                    <SafeAnswerText text={deterministicAnswer} />
                </p>
            ) : null}
            {hasJudgment ? (
                <p className="answer__body">
                    <SafeAnswerText text={directJudgment} />
                </p>
            ) : (
                <p className="panel__empty">The service returned no direct judgment.</p>
            )}
            {hasCurrentState ? (
                <details className="disclosure">
                    <summary>More detail</summary>
                    <p className="answer__body">
                        <SafeAnswerText text={result.current_state} />
                    </p>
                </details>
            ) : null}
        </section>
    );
}
