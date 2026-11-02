import { createContext, type ReactElement } from "react";

import type { RenderShape } from "../lib/contracts";

/** A host's chart for one verified shape, or `null` when it has none. */
export type ShapeSlot = (shape: RenderShape) => ReactElement | null;

/**
 * The host's charts, for every panel inside an answer. A context, as `EvidenceOpenContext` is: the
 * panels take no prop for it. With none (the default, standalone and the Workbench), `RichShape`
 * shows the value table.
 */
export const ShapeSlotContext = createContext<ShapeSlot | null>(null);
