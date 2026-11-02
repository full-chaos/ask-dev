import { Component, useContext, type ReactNode } from "react";

import { ShapeDataTable } from "./RenderShapeChart";
import { ShapeSlotContext } from "./ShapeSlotContext";
import type { RenderShape } from "../lib/contracts";
import { axisLabels } from "../lib/render-shapes";

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

function HostChart({ shape }: { readonly shape: RenderShape }) {
    const slot = useContext(ShapeSlotContext);
    const chart = slot?.(shape) ?? null;
    if (chart === null) return <NoChart shape={shape} />;
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
export function RichShape({ shape }: { readonly shape: RenderShape }) {
    return (
        <figure className="render-shape">
            <figcaption className="render-shape__title">{shape.title}</figcaption>
            <HostChartBoundary fallback={<NoChart shape={shape} />}>
                <HostChart shape={shape} />
            </HostChartBoundary>
        </figure>
    );
}
