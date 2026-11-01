import { useContext } from "react";

import { ShapeDataTable } from "./RenderShapeChart";
import { ShapeSlotContext } from "./ShapeSlotContext";
import type { RenderShape } from "../lib/contracts";
import { axisLabels } from "../lib/render-shapes";

/**
 * A verified shape whose chart belongs to the host (rich views plan, section 2). ask-dev keeps what
 * must be one copy of the truth: the title, the value table and the notice. The table is the
 * accessible form of a chart that draws on canvas. With no chart it is what the reader sees, and one
 * line says so: never a silent absence.
 */
export function RichShape({ shape }: { readonly shape: RenderShape }) {
    const slot = useContext(ShapeSlotContext);
    const chart = slot?.(shape) ?? null;
    return (
        <figure className="render-shape">
            <figcaption className="render-shape__title">{shape.title}</figcaption>
            {chart ?? (
                <p className="record__meta" data-testid="rich-shape-not-shown">
                    The chart is not shown here.
                </p>
            )}
            <ShapeDataTable labels={axisLabels(shape)} shape={shape} visible={chart === null} />
        </figure>
    );
}
