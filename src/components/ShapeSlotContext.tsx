import { createContext, type ReactElement } from "react";

import type { RenderShape } from "../lib/contracts";
import type { ShapeDetail } from "../lib/render-shapes";

/**
 * A host's chart for one verified shape, or `null` when it has none. Return null, never an element
 * that draws nothing: the render cannot tell one from a chart until it has drawn, so that reader gets
 * no chart and no notice. The host holds this rule (CHAOS-12538).
 *
 * `detail` is set for a kind that needs more than its points to draw as the host's page does: a
 * `forecast` gets its claim's served summary and rows (CHAOS-4613). A host that does not read it
 * takes one argument, as before.
 */
export type ShapeSlot = (shape: RenderShape, detail?: ShapeDetail) => ReactElement | null;

/**
 * The host's charts, for every panel inside an answer. A context, as `EvidenceOpenContext` is: the
 * panels take no prop for it. With none (the default, standalone and the Workbench), `RichShape`
 * shows the value table.
 */
export const ShapeSlotContext = createContext<ShapeSlot | null>(null);
