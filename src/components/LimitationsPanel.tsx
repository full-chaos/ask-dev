import { useId } from "react";

import type { DedupedLimitation } from "@/lib/fact-dedup";
import { SURFACE_LABEL } from "@/lib/fact-dedup";
import type { InvestigationResult } from "@/lib/contracts";

export type LimitationsPanelProps = {
    /**
     * CHAOS-4669 defect 1: `@/lib/fact-dedup`'s dedup verdict, not a bare
     * `string[]` — the same fact commonly reaches Limitations AND one of
     * the three Finding-card surfaces (near-verbatim, per chris's own UX
     * notes). Callers with nothing to dedupe against (the
     * `clarification_required` branch) pass `identityLimitations(...)`.
     */
    readonly limitations: readonly DedupedLimitation[];
    readonly warnings: InvestigationResult["warnings"];
};

/**
 * Limitations (always rendered, even empty — an explicit "the service
 * reported no limitations" is not the same claim as no panel at all) plus
 * warnings, when any were sent.
 *
 * Extracted out of `DeterministicAnswerView`'s two near-identical inline
 * copies (decisive and clarification branches) so CHAOS-4581's compact
 * "strip" treatment lives in one place. Each caller already supplies its own
 * `useId()`-derived instance, so this component owns its own heading id too
 * — CHAOS-4510 discipline, matching `AnswerPanel`/`CoveragePanel`.
 */
export function LimitationsPanel({ limitations, warnings }: LimitationsPanelProps) {
    const idPrefix = useId();
    return (
        <section
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-limitations-title`}
        >
            <h2 className="panel__title" id={`${idPrefix}-limitations-title`}>
                Limitations
            </h2>
            {limitations.length === 0 ? (
                <p className="panel__empty">The service reported no limitations.</p>
            ) : (
                <ul className="stack stack--tight">
                    {limitations.map((limitation) =>
                        limitation.isDuplicate ? (
                            <li className="record record--reference" key={limitation.text}>
                                Already shown in full under{" "}
                                {SURFACE_LABEL[limitation.primarySurface]}.
                            </li>
                        ) : (
                            <li className="record" key={limitation.text}>
                                {limitation.text}
                            </li>
                        ),
                    )}
                </ul>
            )}
            {warnings.length > 0 ? (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Warnings
                    </h3>
                    <ul className="stack stack--tight">
                        {warnings.map((warning) => (
                            <li className="record" key={warning}>
                                {warning}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </section>
    );
}
