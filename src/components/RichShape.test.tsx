import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RichShape } from "@/components/RichShape";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import type { RenderShape } from "@/lib/contracts";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(cleanup);

/**
 * A real served shape read as a treemap. ACR emits none yet (CHAOS-12496), so this is a changed
 * real shape until the producer gives a fixture from the real selector.
 */
const real = servedShapeScenarios["category-order"].render_shapes!.find(
    (shape) => shape.selected_by === "cohort_attention_score",
)!;
const shape = { ...real, kind: "treemap", presentation: undefined } as unknown as RenderShape;

const NOT_SHOWN = "The chart is not shown here.";

const draw = (slot: ShapeSlot | null) =>
    render(
        <ShapeSlotContext.Provider value={slot}>
            <RichShape shape={shape} />
        </ShapeSlotContext.Provider>,
    );

const rows = () =>
    within(screen.getByRole("table", { hidden: true }))
        .getAllByRole("row", { hidden: true })
        .slice(1)
        .map((row) => row.textContent);

describe("a rich shape reaches the host's chart through one seam (CHAOS-12496)", () => {
    it("gives the host the verified shape and draws what it returns", () => {
        const slot = vi.fn(() => <div data-testid="host-chart">chart</div>);
        draw(slot);
        expect(slot).toHaveBeenCalledWith(shape);
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });

    it("keeps the value table as the chart's accessible form, out of sight", () => {
        draw(() => <div>chart</div>);
        const table = screen.getByRole("table", { hidden: true });
        expect(table.closest(".sr-only")).not.toBeNull();
        expect(rows()).toHaveLength(shape.series[0]!.points.length);
    });

    it("names the shape with its served title", () => {
        draw(() => <div>chart</div>);
        expect(screen.getByRole("figure")).toHaveTextContent(shape.title);
    });
});

describe("no chart is never a silent absence (CHAOS-12496)", () => {
    it.each<[string, ShapeSlot | null]>([
        ["with no slot, as in standalone and the Workbench", null],
        ["when the slot returns null", () => null],
    ])("shows the value table and one line %s", (_, slot) => {
        draw(slot);
        expect(screen.getByText(NOT_SHOWN)).toBeVisible();
        expect(screen.getByRole("table").closest(".sr-only")).toBeNull();
        expect(rows()).toHaveLength(shape.series[0]!.points.length);
    });

    it("shows each value exactly as served", () => {
        draw(null);
        const points = shape.series[0]!.points;
        expect(rows()).toEqual(points.map((point) => `${point.label}${String(point.value)}`));
    });
});
