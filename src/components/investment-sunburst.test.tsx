import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import type { InvestigationResult } from "@/lib/contracts";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(cleanup);

// CHAOS-12812: a verified sunburst belongs to the panel of the fact it cites, and the host draws it
// through the slot, as a treemap is drawn (CHAOS-12496). The fixture is ACR's real encoder output.
const answer = servedShapeScenarios["investment-sunburst"];
const sunburst = answer.render_shapes![0]!;
const NOT_SHOWN = "The chart is not shown here.";

const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
    render(
        <ShapeSlotContext.Provider value={slot}>
            <DeterministicAnswerView offersPresentation="popup" result={result} />
        </ShapeSlotContext.Provider>,
    );
const figure = () =>
    screen.getByText(sunburst.title, { selector: "figcaption" }).closest("figure")!;

describe("a served sunburst on the answer (CHAOS-12812)", () => {
    it("draws the host's chart, once, for the verified shape", () => {
        const slot = vi.fn<ShapeSlot>(() => <div data-testid="host-chart">chart</div>);
        draw(answer, slot);
        expect(slot).toHaveBeenCalledTimes(1);
        expect(slot.mock.calls[0]?.[0].shape_id).toBe(sunburst.shape_id);
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });

    it("shows the line and the served words with no host chart, as standalone does", () => {
        draw(answer);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
        for (const word of ["Bugfix", "Customer", "Incident Response"]) {
            expect(within(figure()).getAllByText(word).length).toBeGreaterThan(0);
        }
    });

    it("gives the host no shape that failed its check, and says it was withheld", () => {
        const result = structuredClone(answer);
        result.render_shapes![0]!.series[1]!.points[0].value += 0.01;
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        draw(result, slot);
        expect(slot).not.toHaveBeenCalled();
        expect(screen.getByTestId("rich-shape-withheld")).toHaveTextContent("A chart was withheld");
    });

    it("is accounted for: the panel takes it, so no other notice says it", () => {
        draw(answer);
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });
});
