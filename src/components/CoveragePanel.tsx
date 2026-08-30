import { useId } from "react";

import { Badge } from "@/components/Badge";
import type { Coverage } from "@/lib/contracts";
import { coverageStateTone, humanizeTerm } from "@/lib/presentation";

export type CoveragePanelProps = {
    readonly coverage: Coverage;
};

/**
 * Shows what the investigation could and could not read.
 *
 * Every source is listed with its contract state term, including the ones
 * that carry no data — `pruned`, `unauthorized`, `no_data`. Hiding them would
 * turn a known gap into apparent completeness, which is the one thing this
 * panel exists to prevent — so CHAOS-4581's compact "strip" treatment below
 * only changes how much is visible BY DEFAULT, never what is reachable: a
 * one-line summary plus a tone-coded chip per source is always on screen,
 * and the full per-source reason/observed-at breakdown is one click away in
 * a `<details>`, not removed.
 */
export function CoveragePanel({ coverage }: CoveragePanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns.
    const idPrefix = useId();
    const degradedReasons = coverage.degraded_reasons ?? [];
    return (
        <section
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-coverage-title`}
            data-testid="coverage-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-coverage-title`}>
                Coverage
            </h2>
            <p className="record__meta">
                {coverage.partial
                    ? "Partial — some sources did not contribute."
                    : "Complete — every source contributed."}
            </p>
            {coverage.sources.length === 0 ? (
                <p className="panel__empty">No sources were recorded.</p>
            ) : (
                <>
                    <div className="chip-row" data-testid="coverage-chip-row">
                        {coverage.sources.map((source) => (
                            <Badge
                                key={`${source.source}:${source.state}`}
                                tone={coverageStateTone(source.state)}
                                title={`${source.source}: ${source.state}`}
                            >
                                {source.source}
                            </Badge>
                        ))}
                    </div>
                    <details className="disclosure">
                        <summary>Source details</summary>
                        <div className="coverage">
                            {coverage.sources.map((source) => (
                                <div
                                    className="coverage__source"
                                    key={`${source.source}:${source.state}`}
                                >
                                    <span className="coverage__name">{source.source}</span>
                                    <Badge
                                        tone={coverageStateTone(source.state)}
                                        title={source.state}
                                    >
                                        {humanizeTerm(source.state)}
                                    </Badge>
                                    {source.reason !== undefined ? (
                                        <p className="coverage__reason">{source.reason}</p>
                                    ) : null}
                                    {source.observed_at !== undefined ? (
                                        <p className="coverage__reason">
                                            observed at {source.observed_at}
                                        </p>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </details>
                </>
            )}
            {degradedReasons.length > 0 ? (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Degraded reasons
                    </h3>
                    <ul className="stack stack--tight">
                        {degradedReasons.map((reason) => (
                            <li className="record" key={reason}>
                                {reason}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </section>
    );
}
