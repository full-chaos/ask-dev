import { Component, isValidElement, useContext, type ReactNode } from "react";

import { ShapeDataTable } from "./RenderShapeChart";
import { ShapeSlotContext } from "./ShapeSlotContext";
import type { RenderShape } from "../lib/contracts";
import { axisLabels, type ShapeDetail } from "../lib/render-shapes";

/** No chart: the value table is what the reader sees, and one line says so. */
function NoChart({ shape }: { readonly shape: RenderShape }) {
    return (
        <>
            <p className="record__meta" data-testid="rich-shape-not-shown">
                The chart is not shown here.
            </p>
            <ShapeDataTable labels={axisLabels(shape)} shape={shape} visible />
        </>
    );
}

function HostChart({
    shape,
    detail,
}: {
    readonly shape: RenderShape;
    readonly detail?: ShapeDetail | undefined;
}) {
    const slot = useContext(ShapeSlotContext);
    // A kind with no detail is called as before, with the shape alone.
    const chart: unknown = detail === undefined ? slot?.(shape) : slot?.(shape, detail);
    // Only an element draws: `false`, `undefined` or "" would leave the reader nothing, and no notice.
    if (!isValidElement(chart)) return <NoChart shape={shape} />;
    return (
        <>
            {chart}
            <ShapeDataTable labels={axisLabels(shape)} shape={shape} />
        </>
    );
}

type BoundaryProps = { readonly fallback: ReactNode; readonly children: ReactNode };

/** A host's chart is not ours to trust: if it throws, the answer stays and the table shows. */
class HostChartBoundary extends Component<BoundaryProps, { readonly failed: boolean }> {
    override state = { failed: false };

    static getDerivedStateFromError(): { readonly failed: boolean } {
        return { failed: true };
    }

    override render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

/**
 * A verified shape whose chart belongs to the host (rich views plan, section 2). ask-dev keeps what
 * must be one copy of the truth: the title, the value table and the notice. The table is the
 * accessible form of a chart that draws on canvas. With no chart it is what the reader sees, and one
 * line says so: never a silent absence.
 */
export function RichShape({
    shape,
    detail,
}: {
    readonly shape: RenderShape;
    /** For a kind that needs it (`shapeDetail`), handed to the host's slot. */
    readonly detail?: ShapeDetail | undefined;
}) {
    return (
        <figure className="render-shape">
            <figcaption className="render-shape__title">{shape.title}</figcaption>
            <HostChartBoundary fallback={<NoChart shape={shape} />}>
                <HostChart detail={detail} shape={shape} />
            </HostChartBoundary>
        </figure>
    );
}
