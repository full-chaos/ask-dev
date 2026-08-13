import { Badge } from "@/components/Badge";
import type { Coverage } from "@/lib/contracts";
import { coverageStateTone, humanizeTerm } from "@/lib/presentation";

export type CoveragePanelProps = {
    readonly coverage: Coverage;
};

/**
 * Shows what the investigation could and could not read.
 *
 * Every source is listed with its contract state term, including the ones that
 * carry no data — `pruned`, `unauthorized`, `no_data`. Hiding them would turn a
 * known gap into apparent completeness, which is the one thing this panel
 * exists to prevent.
 */
export function CoveragePanel({ coverage }: CoveragePanelProps) {
    const degradedReasons = coverage.degraded_reasons ?? [];
    return (
        <section className="panel" aria-labelledby="coverage-title">
            <h2 className="panel__title" id="coverage-title">
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
                <div className="coverage">
                    {coverage.sources.map((source) => (
                        <div className="coverage__source" key={`${source.source}:${source.state}`}>
                            <span className="coverage__name">{source.source}</span>
                            <Badge tone={coverageStateTone(source.state)} title={source.state}>
                                {humanizeTerm(source.state)}
                            </Badge>
                            {source.reason !== undefined ? (
                                <p className="coverage__reason">{source.reason}</p>
                            ) : null}
                            {source.observed_at !== undefined ? (
                                <p className="coverage__reason">observed at {source.observed_at}</p>
                            ) : null}
                        </div>
                    ))}
                </div>
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
