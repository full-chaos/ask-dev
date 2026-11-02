import type { ClaimedFactTable, InvestigationResult, RenderShape } from "./contracts";
import { renderableRowsSource } from "./render-shapes";

/** ACR's closed unit vocabulary (CHAOS-11984): count, ratio, hours, days, points. */
export type MeasureUnit = NonNullable<ClaimedFactTable["measure_units"]>[number]["unit"];

/**
 * The unit a table declares for one of its measures (CHAOS-12570), or `undefined`. ACR states a
 * unit only from the producer's own declaration, so this is the only source: a column the table
 * does not list as a measure gets none, and so does a measure with no entry. No name, no
 * neighbour's unit, no guess.
 */
export function declaredUnit(
    table: ClaimedFactTable | undefined,
    measure: string,
): MeasureUnit | undefined {
    if (table?.measures?.includes(measure) !== true) return undefined;
    return table.measure_units?.find((entry) => entry.measure === measure)?.unit;
}

/**
 * The one unit every point of a shape cites (CHAOS-12570), or `undefined`. A point names a claim's
 * row and field; the table that declares that row is the claim's `time_series_table` when the
 * shape plots `time_series_rows`, else its `table` (`renderableRowsSource`, the same choice the
 * verifier resolves points with). A point that is not a claimed-fact row, a measure with no unit,
 * or two points of different units: no unit.
 */
export function shapeMeasureUnit(
    shape: RenderShape,
    result: InvestigationResult,
): MeasureUnit | undefined {
    let unit: MeasureUnit | undefined;
    for (const series of shape.series) {
        for (const { source } of series.points) {
            if (source.kind !== "claimed_fact_row" || source.field === undefined) return undefined;
            const claim = result.claimed_facts.find((fact) => fact.claim_id === source.claim_id);
            if (claim === undefined) return undefined;
            const table =
                renderableRowsSource(claim) === "time_series_rows"
                    ? claim.time_series_table
                    : claim.table;
            const pointUnit = declaredUnit(table, source.field);
            if (pointUnit === undefined || (unit !== undefined && pointUnit !== unit)) {
                return undefined;
            }
            unit = pointUnit;
        }
    }
    return unit;
}
