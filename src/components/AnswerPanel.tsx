import { useId } from "react";

import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { InvestigationResult } from "@/lib/contracts";

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
 */
export function AnswerPanel({ result }: AnswerPanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns and every later turn's
    // `aria-labelledby` resolved to the FIRST turn's heading.
    const idPrefix = useId();
    const hasJudgment = result.direct_judgment.trim() !== "";
    const hasCurrentState = result.current_state.trim() !== "";
    return (
        <section
            className="panel"
            aria-labelledby={`${idPrefix}-answer-title`}
            data-testid="answer-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-answer-title`}>
                Answer
            </h2>
            <p className="answer__judgment">
                <SafeAnswerText text={result.deterministic_answer} />
            </p>
            {hasJudgment ? (
                <p className="answer__body">
                    <SafeAnswerText text={result.direct_judgment} />
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
