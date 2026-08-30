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
 * ordering comment), and stays short once it gets there:
 * `deterministic_answer` (the service's own non-model wording) is the one
 * paragraph shown by default. `direct_judgment` and `current_state` — the
 * fields where a long fact dump tends to land (CHAOS-4580 is shrinking that
 * on the acr side) — sit behind a closed `<details>` instead of inline, so
 * whatever prose arrives never reintroduces a wall of text between the
 * panels and the fold. Nothing is summarized, reordered by importance, or
 * filled with the workbench's own words: an empty judgment still renders as
 * an explicit absence, just inside the same disclosure. `strongest_pressures`
 * and `drivers` moved out to `DriversPanel` (CHAOS-4581) — a panel, not
 * prose.
 */
export function AnswerPanel({ result }: AnswerPanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns and every later turn's
    // `aria-labelledby` resolved to the FIRST turn's heading.
    const idPrefix = useId();
    const hasJudgment = result.direct_judgment.trim() !== "";
    const hasCurrentState = result.current_state.trim() !== "";
    const hasMore = hasJudgment || hasCurrentState;
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
            {hasMore ? (
                <details className="disclosure">
                    <summary>Full answer</summary>
                    {hasJudgment ? (
                        <p className="answer__body">
                            <SafeAnswerText text={result.direct_judgment} />
                        </p>
                    ) : (
                        <p className="panel__empty">The service returned no direct judgment.</p>
                    )}
                    {hasCurrentState ? (
                        <p className="answer__body">
                            <SafeAnswerText text={result.current_state} />
                        </p>
                    ) : null}
                </details>
            ) : (
                <p className="panel__empty">The service returned no direct judgment.</p>
            )}
        </section>
    );
}
