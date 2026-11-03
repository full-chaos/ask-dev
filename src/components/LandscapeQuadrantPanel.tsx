import { RichShape } from "./RichShape";
import type { InvestigationResult } from "../lib/contracts";
import { LANDSCAPE_POSITION_RULE, renderShapesFor } from "../lib/render-shapes";

/**
 * Where teams stand on churn and delivery units on one day (CHAOS-12624). The quadrant cites one
 * claim per team and measure, so it belongs to no one fact's panel: it has a panel of its own, drawn
 * once per answer. The chart is the host's (`RichShape`); ask-dev keeps the served title, the value
 * table and the notice. A quadrant that fails its check is withheld, and one line says so.
 */
export function LandscapeQuadrantPanel({ result }: { readonly result: InvestigationResult }) {
    const { shapes, withheld } = renderShapesFor(result, [LANDSCAPE_POSITION_RULE]);
    return (
        <>
            {shapes.map((shape) => (
                <section
                    aria-label={shape.title}
                    className="panel panel--card"
                    data-testid="landscape-quadrant"
                    key={shape.shape_id}
                    role="group"
                >
                    <RichShape shape={shape} />
                </section>
            ))}
            {withheld > 0 ? (
                <p className="record__meta" data-testid="landscape-quadrant-withheld">
                    {withheld === 1 ? "A chart was" : `${String(withheld)} charts were`} withheld:
                    it could not be checked against the facts it cites in this answer.
                </p>
            ) : null}
        </>
    );
}
