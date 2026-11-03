import { useId } from "react";

import { ShapeDataTable } from "./RenderShapeChart";
import { useVocabularyWord } from "./VocabularyWordContext";
import type { InvestigationResult, RenderShape } from "../lib/contracts";
import { axisLabels, FORECAST_PERCENTILES_RULE, renderShapesFor } from "../lib/render-shapes";

/**
 * Each scope of the table whose forecast draws no curve, with acr's word for why: no run finished
 * within the horizon, no stored distribution, and so on. A scope whose distribution is available
 * has no line. The state and its word are served; nothing is inferred.
 */
function NoCurveStates({
    shape,
    result,
}: {
    readonly shape: RenderShape;
    readonly result: InvestigationResult;
}) {
    const word = useVocabularyWord();
    const states = shape.series.flatMap((series) => {
        const claimId = series.points[0]?.source.claim_id;
        const matches = result.claimed_facts.filter((fact) => fact.claim_id === claimId);
        const state = matches.length === 1 ? matches[0]!.completion_forecast?.state : undefined;
        return state === undefined || state === "available"
            ? []
            : [{ key: series.key, label: series.label, state }];
    });
    if (states.length === 0) return null;
    return (
        <ul className="record__meta" data-testid="forecast-percentiles-states">
            {states.map(({ key, label, state }) => (
                <li key={key}>
                    {label}: {word("completion_distribution_state", state)}
                </li>
            ))}
        </ul>
    );
}

/**
 * The completion forecast percentiles (CHAOS-4613): one column per team scope, one row per served
 * P50/P85/P95 day. acr serves it only when it draws no curve. The table is the view, so it needs no
 * host chart. A percentile a scope does not serve is a dash, never 0.
 */
export function ForecastPercentilesPanel({ result }: { readonly result: InvestigationResult }) {
    const titleId = useId();
    const { shapes, withheld } = renderShapesFor(result, [FORECAST_PERCENTILES_RULE]);
    return (
        <>
            {shapes.map((shape) => (
                <section
                    aria-labelledby={`${titleId}-${shape.shape_id}`}
                    className="panel forecast-percentiles"
                    data-testid="forecast-percentiles"
                    key={shape.shape_id}
                    role="group"
                >
                    <h2 className="panel__title" id={`${titleId}-${shape.shape_id}`}>
                        {shape.title}
                    </h2>
                    <ShapeDataTable labels={axisLabels(shape)} shape={shape} visible />
                    <NoCurveStates result={result} shape={shape} />
                </section>
            ))}
            {withheld > 0 ? (
                <p className="record__meta" data-testid="forecast-percentiles-withheld">
                    {withheld === 1 ? "A table was" : `${String(withheld)} tables were`} withheld:
                    it could not be checked against the facts it cites in this answer.
                </p>
            ) : null}
        </>
    );
}
