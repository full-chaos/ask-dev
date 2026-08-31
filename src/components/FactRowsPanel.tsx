import { useId } from "react";

import { FactChart } from "@/components/FactChart";
import { FactTable } from "@/components/FactTable";
import { RenderShapeChart } from "@/components/RenderShapeChart";
import type { ClaimedFact, InvestigationResult, RenderShape } from "@/lib/contracts";
import {
    factRowTiles,
    factsWithRows,
    findRollupBasis,
    groupFactsByTable,
    selectPresentation,
} from "@/lib/fact-rows";
import { trendShapesForClaim } from "@/lib/render-shapes";
import { humanizeTerm } from "@/lib/presentation";

export type FactRowsPanelsProps = {
    readonly facts: readonly ClaimedFact[];
    /**
     * CHAOS-4415: the whole answer, so a fact's panel can show the TREND acr
     * selected for it and re-resolve every plotted number against this same
     * document. Optional: a pre-4415 answer carries no shapes and each panel
     * falls back to its own CHAOS-4355 table/chart choice, unchanged.
     */
    readonly result: InvestigationResult | undefined;
};

/**
 * One panel per DISTINCT table a claimed fact's `rows` names (CHAOS-4347),
 * stacked under the answer text (CHAOS-4355). A fact with no `rows`, or an
 * empty `rows` array, contributes nothing — an empty state here only ever
 * means "the service sent no table for this fact", never a missing feature.
 *
 * CHAOS-4672: the service attaches the WHOLE table to every claim that cites
 * it, so several claims (different `field`s, e.g. one measure per claim)
 * commonly carry byte-identical `rows` — one row table, multiple claims. Such
 * claims are grouped by `groupFactsByTable` and render ONE panel, not one
 * each; the panel titled by whichever claim reached the table first lists
 * the others as references rather than re-plotting their identical rows.
 */
export function FactRowsPanels({ facts, result }: FactRowsPanelsProps) {
    const withRows = factsWithRows(facts);
    if (withRows.length === 0) return null;
    const groups = groupFactsByTable(withRows);
    return (
        <>
            {groups.map((group) => (
                <FactRowsPanel
                    allFacts={facts}
                    alsoClaims={group.alsoClaims}
                    fact={group.primary}
                    key={group.primary.claim_id}
                    result={result}
                />
            ))}
        </>
    );
}

type FactRowsPanelProps = {
    readonly fact: ClaimedFact;
    /** Every other claim that cites the SAME table as `fact` (CHAOS-4672) — referenced, never re-plotted. */
    readonly alsoClaims: readonly ClaimedFact[];
    readonly allFacts: readonly ClaimedFact[];
    readonly result: InvestigationResult | undefined;
};

/**
 * Merges acr's own server-selected trend shapes across every claim in a
 * CHAOS-4672 table group, not just the panel's primary claim — a shape
 * `trendShapesForClaim` would have drawn for a claim that is now folded into
 * `alsoClaims` must still be drawn HERE, on the one panel left standing for
 * their shared table (never silently dropped by the dedupe). A shape is
 * "owned" by at most one claim (`trendShapesForClaim`'s own ownership rule:
 * every point cites ONLY that claim), so `shapes` from different claim ids
 * are already disjoint — the `Map` below is defense in depth, not a real
 * collision. `withheld` is summed per claim rather than deduplicated: the
 * safe direction for a count whose whole purpose is "surface an answer-
 * quality failure, never swallow it" is to over-report, not under-report,
 * on the rare case a withheld candidate mentions more than one claim in the
 * group.
 */
function trendsForGroup(
    result: InvestigationResult | undefined,
    claimIds: readonly string[],
): { readonly shapes: readonly RenderShape[]; readonly withheld: number } {
    if (result === undefined) return { shapes: [], withheld: 0 };
    const shapeById = new Map<string, RenderShape>();
    let withheld = 0;
    for (const claimId of claimIds) {
        const perClaim = trendShapesForClaim(result, claimId);
        for (const shape of perClaim.shapes) shapeById.set(shape.shape_id, shape);
        withheld += perClaim.withheld;
    }
    return { shapes: [...shapeById.values()], withheld };
}

function FactRowsPanel({ fact, alsoClaims, allFacts, result }: FactRowsPanelProps) {
    const rows = fact.rows ?? [];
    // A WITHHELD trend suppresses the heuristic chart too, not just a
    // rendered one: falling back would draw a client-side chart for exactly
    // the rows whose SERVER-chosen chart was just refused as untrustworthy,
    // leaving a "chart withheld" notice sitting beside a chart — the
    // opposite of failing closed (codex round 1, P2).
    //
    // CHAOS-4415: acr's OWN selection wins over this panel's CHAOS-4355
    // client-side heuristic. Both look at the same rows, but only acr can see
    // the interpreted intent, and only acr's shape carries a per-point source
    // this view can check. Where acr selected a trend, the heuristic chart is
    // replaced by it — never drawn beside it, which would show one fact's
    // numbers twice under two different selection rules.
    const trends = trendsForGroup(result, [fact.claim_id, ...alsoClaims.map((c) => c.claim_id)]);
    const presentation =
        trends.shapes.length > 0 || trends.withheld > 0
            ? { mode: "table" as const }
            : selectPresentation(rows);
    // `rollup_basis` states how a rollup fact (e.g. a project's per-team
    // breakdown) was derived — see fact-rows.ts's `findRollupBasis` doc
    // comment. It is a SIBLING claim, not a property of this fact, and is
    // absent for an ordinary (non-rollup) fact with rows; the caption
    // always shows the subject and row count regardless, so provenance is
    // never blank even when there is no rollup basis to disclose.
    const rollupBasis = findRollupBasis(allFacts, fact);
    // CHAOS-4510 class (codex review round 1, CHAOS-4581): `claim_id` alone
    // is not guaranteed unique ACROSS stacked chat turns, so a bare
    // `fact-rows-${claim_id}` id could collide the same way the fully-static
    // panel ids did. `idPrefix` keeps the literal `fact-rows-` lead (an
    // existing pinned test selects on that prefix) while making the whole id
    // instance-unique, same pattern as every other panel touched here.
    const idPrefix = useId();
    const titleId = `fact-rows-${idPrefix}-${fact.claim_id}`;
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
            {alsoClaims.length > 0 ? (
                // CHAOS-4672: this table backs more than one claim. The
                // OTHER claims are referenced here, not re-plotted as their
                // own duplicate chart group — see `groupFactsByTable`.
                <p className="fact-panel__caption" data-testid="fact-also-referenced">
                    Also referenced by{" "}
                    {alsoClaims.map((claim) => humanizeTerm(claim.field)).join(", ")}.
                </p>
            ) : null}
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
            {
                // acr's own selection, above the table it was derived from.
                // The table always follows: a chart is a reading of the rows,
                // never a replacement for them.
            }
            {trends.shapes.map((trend) => (
                <RenderShapeChart key={trend.shape_id} shape={trend} />
            ))}
            {trends.withheld > 0 ? (
                <p className="fact-panel__caption" data-testid="trend-shape-withheld">
                    {trends.withheld === 1
                        ? "A trend chart was"
                        : `${trends.withheld} trend charts were`}{" "}
                    withheld: it could not be checked against this fact&apos;s own rows.
                </p>
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
