import { useId } from "react";

import { ShapeDataTable } from "./RenderShapeChart";
import type { InvestigationResult, RenderShape } from "../lib/contracts";
import { axisLabels, COMPARISON_RULE, renderShapesFor } from "../lib/render-shapes";

function ComparisonTable({ shape }: { readonly shape: RenderShape }) {
    const titleId = useId();
    return (
        <section
            aria-labelledby={titleId}
            className="panel"
            data-testid="comparison-table"
            role="group"
        >
            <h2 className="panel__title" id={titleId}>
                {shape.title}
            </h2>
            <ShapeDataTable labels={axisLabels(shape)} shape={shape} visible />
        </section>
    );
}

/**
 * A side-by-side comparison (CHAOS-12513): one column per subject, one row per measure. The table is
 * the view, so it needs no host chart, and a measure one side lacks is a dash, never 0.
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
