import { Badge } from "../Badge";
import type { InvestigationResult } from "../../lib/contracts";
import { coverageStateTone, humanizeTerm, nonBlank } from "../../lib/presentation";

export type InspectorRailProps = {
    /** The latest ANSWERED result; undefined before the first answer. */
    readonly result: InvestigationResult | undefined;
};

/** Same floor `CoveragePanel` uses for a source with no readable label. */
const GENERIC_SOURCE_LABEL = "Source";

function formatDay(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Right rail: what the latest answer read and over which window. A summary
 * of fields the result already carries (`coverage.sources`,
 * `effective_evidence_window`), both kept by the ranking-withheld boundary;
 * the answer's own CoveragePanel stays the full account. Every source is
 * listed with its own state, and an absent window reads "Not reported" —
 * missing is never shown as fresh or complete.
 */
export function InspectorRail({ result }: InspectorRailProps) {
    if (result === undefined) {
        return (
            <aside aria-label="Latest answer sources" className="ask__rail ask__rail--right">
                <p className="rail__empty">
                    The sources, their freshness, and the evidence window of the latest answer
                    appear here.
                </p>
            </aside>
        );
    }
    const sources = result.coverage.sources;
    const window = result.effective_evidence_window;
    const windowRange =
        window?.start !== undefined && window.end !== undefined
            ? `${formatDay(window.start)} – ${formatDay(window.end)}`
            : window?.relative_id !== undefined
              ? humanizeTerm(window.relative_id)
              : // A current-state snapshot window (acr #1791) carries only `as_of`.
                window?.as_of !== undefined
                ? `As of ${formatDay(window.as_of)}`
                : undefined;
    return (
        <aside aria-label="Latest answer sources" className="ask__rail ask__rail--right">
            <section className="rail__section">
                <h2 className="rail__label">Sources &amp; freshness</h2>
                {sources.length === 0 ? (
                    <p className="rail__note">No source was read for this answer.</p>
                ) : (
                    <ul className="rail__rows">
                        {sources.map((source, index) => (
                            <li className="rail__row" key={`${source.source}-${index}`}>
                                <span className="rail__row-name">
                                    {nonBlank(source.label) ?? GENERIC_SOURCE_LABEL}
                                </span>
                                <Badge
                                    data-value={source.state}
                                    tone={coverageStateTone(source.state)}
                                >
                                    {nonBlank(source.state_label) ?? humanizeTerm(source.state)}
                                </Badge>
                                {source.observed_at === undefined ? null : (
                                    <span className="rail__row-meta">
                                        Observed {formatDay(source.observed_at)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section className="rail__section">
                <h2 className="rail__label">Evidence window</h2>
                {windowRange === undefined ? (
                    <p className="rail__note">Not reported.</p>
                ) : (
                    <p className="rail__value">{windowRange}</p>
                )}
                {window === undefined ? null : (
                    <p className="rail__note" data-value={window.provenance}>
                        {humanizeTerm(window.provenance)}
                    </p>
                )}
            </section>
        </aside>
    );
}
