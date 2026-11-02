import { useId } from "react";

import { Details } from "./Details";
import { formatDisplay, ShapeDataTable } from "./RenderShapeChart";
import type { InvestigationResult, RenderShape } from "../lib/contracts";
import { axisLabels, COMPARISON_RULE, renderShapesFor } from "../lib/render-shapes";

function ComparisonTable({ shape }: { readonly shape: RenderShape }) {
    const titleId = useId();
    const labels = axisLabels(shape);
    const rounds = shape.series.some((series) =>
        series.points.some((point) => formatDisplay(point.value) !== String(point.value)),
    );
    return (
        <section
            aria-labelledby={titleId}
            className="panel comparison-table"
            data-testid="comparison-table"
            role="group"
        >
            <h2 className="panel__title" id={titleId}>
                {shape.title}
            </h2>
            <ShapeDataTable format={formatDisplay} labels={labels} shape={shape} visible />
            {rounds ? (
                <Details data-testid="comparison-table-exact" summary="Exact values">
                    <ShapeDataTable labels={labels} shape={shape} visible />
                </Details>
            ) : null}
        </section>
    );
}

/**
 * A side-by-side comparison (CHAOS-12513): one column per subject, one row per measure. The table is
 * the view, so it needs no host chart, and a measure one side lacks is a dash, never 0. A value
 * prints in the drawn form, and a fold keeps the exact one (lead's ruling on CHAOS-12546).
 */
export function ComparisonTablePanel({ result }: { readonly result: InvestigationResult }) {
    const { shapes, withheld } = renderShapesFor(result, [COMPARISON_RULE]);
    return (
        <>
            {shapes.map((shape) => (
                <ComparisonTable key={shape.shape_id} shape={shape} />
            ))}
            {withheld > 0 ? (
                <p className="record__meta" data-testid="comparison-table-withheld">
                    {withheld === 1 ? "A table was" : `${String(withheld)} tables were`} withheld:
                    it could not be checked against the facts it cites in this answer.
                </p>
            ) : null}
        </>
    );
}
