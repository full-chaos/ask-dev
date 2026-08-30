import { FactChart } from "@/components/FactChart";
import { FactTable } from "@/components/FactTable";
import type { ClaimedFact } from "@/lib/contracts";
import { factRowTiles, factsWithRows, findRollupBasis, selectPresentation } from "@/lib/fact-rows";
import { humanizeTerm } from "@/lib/presentation";

export type FactRowsPanelsProps = {
    readonly facts: readonly ClaimedFact[];
};

/**
 * One panel per claimed fact carrying a renderable `rows` table (CHAOS-4347),
 * stacked under the answer text (CHAOS-4355). A fact with no `rows`, or an
 * empty `rows` array, renders nothing — an empty state here only ever means
 * "the service sent no table for this fact", never a missing feature.
 */
export function FactRowsPanels({ facts }: FactRowsPanelsProps) {
    const withRows = factsWithRows(facts);
    if (withRows.length === 0) return null;
    return (
        <>
            {withRows.map((fact) => (
                <FactRowsPanel allFacts={facts} fact={fact} key={fact.claim_id} />
            ))}
        </>
    );
}

type FactRowsPanelProps = {
    readonly fact: ClaimedFact;
    readonly allFacts: readonly ClaimedFact[];
};

function FactRowsPanel({ fact, allFacts }: FactRowsPanelProps) {
    const rows = fact.rows ?? [];
    const presentation = selectPresentation(rows);
    // `rollup_basis` states how a rollup fact (e.g. a project's per-team
    // breakdown) was derived — see fact-rows.ts's `findRollupBasis` doc
    // comment. It is a SIBLING claim, not a property of this fact, and is
    // absent for an ordinary (non-rollup) fact with rows; the caption
    // always shows the subject and row count regardless, so provenance is
    // never blank even when there is no rollup basis to disclose.
    const rollupBasis = findRollupBasis(allFacts, fact);
    const titleId = `fact-rows-${fact.claim_id}`;
    const tiles = factRowTiles(rows);
    return (
        <section aria-labelledby={titleId} className="panel panel--card">
            <h2 className="panel__title" id={titleId}>
                {humanizeTerm(fact.kind)} · {humanizeTerm(fact.field)}
            </h2>
            <p className="fact-panel__caption">
                {fact.subject.label}
                {rollupBasis !== undefined ? ` · ${humanizeTerm(rollupBasis)}` : ""}
                {` · ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </p>
            {tiles.length > 0 ? (
                // CHAOS-4581 pop-up-card reference: a single-row rollup's own
                // numeric columns, shown as tiles ABOVE the same table — the
                // table below still carries every column, tiled or not.
                <div className="tiles" data-testid="fact-tiles">
                    {tiles.map((tile) => (
                        <div className="tile" key={tile.label}>
                            <span className="tile__value">{String(tile.value ?? "—")}</span>
                            <span className="tile__label">{humanizeTerm(tile.label)}</span>
                        </div>
                    ))}
                </div>
            ) : null}
            {presentation.mode === "chart" ? (
                <>
                    <FactChart
                        axis={presentation.axis}
                        chartKind={presentation.chartKind}
                        rows={rows}
                        seriesColumns={presentation.seriesColumns}
                    />
                    {presentation.truncatedSeriesColumns.length > 0 ? (
                        <p className="fact-panel__caption">
                            +{presentation.truncatedSeriesColumns.length} more numeric column
                            {presentation.truncatedSeriesColumns.length === 1 ? "" : "s"} in the
                            table below.
                        </p>
                    ) : null}
                    {/* The chart is a visual summary; the full data — every
                        row and column, including any past the charted-series
                        cap — is always available as a real table too, not
                        just SVG marks (codex round 1, CHAOS-4355). Visible
                        when series were truncated (the note above points at
                        it); otherwise screen-reader-only, since the chart's
                        own accessible marks (aria-label + title) already
                        cover the charted data for that case. */}
                    <div
                        className={
                            presentation.truncatedSeriesColumns.length > 0 ? undefined : "sr-only"
                        }
                    >
                        <FactTable rows={rows} />
                    </div>
                </>
            ) : (
                <FactTable rows={rows} />
            )}
        </section>
    );
}
