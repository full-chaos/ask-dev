import type { InvestigationResult } from "../lib/contracts";
import { nonBlank } from "../lib/presentation";
import { shapesNoPanelTakes } from "../lib/shape-account";

/** A shape ACR served that no panel draws: said, with its served title, never a silent absence. */
export function ShapesNotDrawn({ result }: { readonly result: InvestigationResult }) {
    const shapes = shapesNoPanelTakes(result);
    if (shapes.length === 0) return null;
    const titles = shapes.flatMap((shape) => nonBlank(shape.title) ?? []);
    return (
        <p className="record__meta" data-testid="render-shapes-not-drawn">
            {shapes.length === 1
                ? "A chart this view cannot draw is not shown"
                : `${String(shapes.length)} charts this view cannot draw are not shown`}
            {titles.length === 0 ? "" : `: ${titles.join("; ")}`}.
        </p>
    );
}
