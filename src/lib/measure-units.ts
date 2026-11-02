import type {
    ClaimedFactTable,
    InvestigationResult,
    RenderPointSource,
    RenderShape,
} from "./contracts";
import { renderableRowsSource } from "./render-shapes";

/** ACR's closed unit vocabulary (CHAOS-11984): count, ratio, hours, days, points. */
export type MeasureUnit = NonNullable<ClaimedFactTable["measure_units"]>[number]["unit"];

/**
 * The unit a table declares for one of its measures (CHAOS-12570), or `undefined`. ACR states a
 * unit only from the producer's own declaration, so this is the only source: a column the table
 * does not list as a measure gets none, and so does a measure with no entry or more than one. No
 * name, no neighbour's unit, no guess.
 */
export function declaredUnit(
    table: ClaimedFactTable | undefined,
    measure: string,
): MeasureUnit | undefined {
    if (table?.measures?.includes(measure) !== true) return undefined;
    // A measure declared more than once is not one declaration: no unit (codex r3 P2).
    const entries = (table.measure_units ?? []).filter((entry) => entry.measure === measure);
    return entries.length === 1 ? entries[0]!.unit : undefined;
}

/**
 * The table that declares the row a point cites: the claim's `time_series_table` when the shapes
 * of that claim plot `time_series_rows`, else its `table` (`renderableRowsSource`, the same choice
 * the verifier resolves points with). `undefined` for a point that cites no claimed-fact row.
 */
export function citedTable(
    source: RenderPointSource,
    result: InvestigationResult,
): ClaimedFactTable | undefined {
    if (source.kind !== "claimed_fact_row") return undefined;
    const claim = result.claimed_facts.find((fact) => fact.claim_id === source.claim_id);
    if (claim === undefined) return undefined;
    return renderableRowsSource(claim) === "time_series_rows"
        ? claim.time_series_table
        : claim.table;
}

/**
 * The declaration a panel that stands for several claims reads units from (CHAOS-12570, codex r1
 * P2). Claims share a panel when their rows are byte-identical (CHAOS-4672), so the panel's numbers
 * are every claim's: a unit is stated only where every claim's table states the same one. This is
 * the first table, with each measure whose unit another claim states differently, or not at all,
 * taken out of `measure_units`. The same holds for a day cadence (CHAOS-12571): a break claims a
 * missing day, so the cadence stays only when every claim's table states it.
 */
export function agreedTable(
    tables: readonly (ClaimedFactTable | undefined)[],
): ClaimedFactTable | undefined {
    const [primary, ...others] = tables;
    if (primary === undefined || others.length === 0) return primary;
    const declared = primary.measure_units ?? [];
    const agreed = declared.filter(({ measure, unit }) =>
        others.every((table) => declaredUnit(table, measure) === unit),
    );
    const cadenceAgrees = others.every((table) => table?.cadence === primary.cadence);
    if (agreed.length === declared.length && cadenceAgrees) return primary;
    const { measure_units: _disagreed, cadence: _cadence, ...rest } = primary;
    return {
        ...rest,
        ...(agreed.length === 0 ? {} : { measure_units: agreed }),
        ...(cadenceAgrees && primary.cadence !== undefined ? { cadence: primary.cadence } : {}),
    };
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
            if (source.field === undefined) return undefined;
            const pointUnit = declaredUnit(citedTable(source, result), source.field);
            if (pointUnit === undefined || (unit !== undefined && pointUnit !== unit)) {
                return undefined;
            }
            unit = pointUnit;
        }
    }
    return unit;
}
