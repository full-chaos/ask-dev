import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, verifyRenderShape } from "@/lib/render-shapes";
import { cohortMemberScenarios } from "@/test/fixtures/cohort-members";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";
import { servedWordScenarios } from "@/test/fixtures/served-words";

afterEach(cleanup);

/** The real selector with the flag on, `Validate` and the real encoder (acr `ab88349f`). */
const answer = servedShapeScenarios["investment-treemap"];
const treemap = answer.render_shapes![0]!;

type Change = (shape: RenderShape, result: InvestigationResult) => void;

function changed(change: Change): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes![0]!;
    change(shape, result);
    return { shape, result };
}

const points = (shape: RenderShape) => shape.series[0].points;
const fact = (result: InvestigationResult) => result.claimed_facts[0]!;

describe("the verifier reads a treemap as one whole (CHAOS-12496)", () => {
    it("the fixture is the case: a served treemap with a measured zero", () => {
        expect(treemap.kind).toBe("treemap");
        expect(treemap.selected_by).toBe("investment_theme_share");
        expect(treemap.value_unit).toBe("ratio");
        expect(points(treemap).map((point) => point.value)).toContain(0);
    });

    it("the fixture passes the result contract the server route holds it to", () => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            answer,
        );
        expect(verdict.errors ?? []).toEqual([]);
        expect(verdict.valid).toBe(true);
    });

    it("accepts the served shape", () => {
        expect(verifyRenderShape(treemap, answer)).toBe(true);
    });

    it.each<[string, Change]>([
        ["a treemap under another rule", (s) => void (s.selected_by = "dated_fact_trend")],
        [
            "the rule on a series",
            (s) => {
                s.kind = "series";
                s.presentation = "bars";
            },
        ],
        ["another non-series kind", (s) => void (s.kind = "sunburst")],
        ["a presentation", (s) => void (s.presentation = "bars")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        [
            "two series",
            (s) => void (s.series as unknown[]).push({ ...s.series[0], key: "share_again" }),
        ],
        ["no unit", (s) => void delete s.value_unit],
        ["a table of another name", (_, r) => void (fact(r).table!.field = "scope_breakdown")],
        ["no declared table", (_, r) => void delete fact(r).table],
        [
            "a time series on the claim, even with the same rows",
            (_, r) => void (fact(r).time_series_rows = structuredClone(fact(r).rows!)),
        ],
        ["a row left out", (s) => void (s.series[0].points as unknown[]).pop()],
        [
            "a point on another field, even with the same value",
            (s, r) => {
                const row = fact(r).rows![0]!;
                row.fields.weighted_effort = row.fields.share!;
                points(s)[0].source.field = "weighted_effort";
            },
        ],
        [
            "a point of another kind",
            (s) => {
                const { source } = points(s)[0];
                source.kind = "cohort_member_score";
            },
        ],
        [
            "a point on another claim",
            (s, r) => {
                r.claimed_facts.push({ ...structuredClone(fact(r)), claim_id: "claim_other_one" });
                points(s)[1]!.source.claim_id = "claim_other_one";
            },
        ],
        [
            "two points on one row",
            (s) => {
                points(s)[1]!.source.row_index = 0;
                points(s)[1]!.value = points(s)[0].value;
            },
        ],
        ["a row with no theme", (_, r) => void delete fact(r).rows![0]!.fields.theme],
        ["a value that is not the row's", (s) => void (points(s)[0].value += 0.01)],
        [
            "a value below 0",
            (s, r) => {
                points(s)[0].value = -0.1;
                fact(r).rows![0]!.fields.share = { number: -0.1 };
            },
        ],
        [
            "one value above 0",
            (s, r) => {
                for (const [index, point] of points(s).entries()) {
                    point.value = index === 0 ? 1 : 0;
                    fact(r).rows![index]!.fields.share = { number: point.value };
                }
            },
        ],
        ["two labels the same", (s) => void (points(s)[1]!.label = points(s)[0].label)],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("holds any shape's ratio to 0 to 1", () => {
        const { shape, result } = changed((s, r) => {
            points(s)[0].value = 1.5;
            fact(r).rows![0]!.fields.share = { number: 1.5 };
        });
        expect(verifyRenderShape(shape, result)).toBe(false);
        const series = structuredClone(servedShapeScenarios["category-order"]);
        const trend = series.render_shapes!.find((s) => s.selected_by === "dated_fact_trend")!;
        expect(verifyRenderShape(trend, series)).toBe(true);
        const big = trend.series[0].points.some((point) => point.value > 1);
        expect(big).toBe(true);
        trend.value_unit = "ratio";
        expect(verifyRenderShape(trend, series)).toBe(false);
    });
});

describe("a served treemap on the answer (CHAOS-12496)", () => {
    const NOT_SHOWN = "The chart is not shown here.";
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );
    const figure = () =>
        screen.getByText(treemap.title, { selector: "figcaption" }).closest("figure")!;

    it("draws the host's chart, once, for the verified shape", () => {
        const slot = vi.fn<ShapeSlot>(() => <div data-testid="host-chart">chart</div>);
        draw(answer, slot);
        expect(slot).toHaveBeenCalledTimes(1);
        expect(slot.mock.calls[0]?.[0].shape_id).toBe(treemap.shape_id);
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });

    it("shows the value table and the line with no host chart, as standalone does", () => {
        draw(answer);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
        for (const point of points(treemap)) {
            expect(within(figure()).getByText(point.label)).toBeVisible();
        }
    });

    it("replaces the fallback chart for that fact: the two never draw together", () => {
        const { container } = draw(answer, () => <div>chart</div>);
        expect(container.querySelector(".fact-chart__svg")).toBeNull();
    });

    it("keeps the fallback chart beside no treemap, as a control", () => {
        const { render_shapes: _gone, ...plain } = structuredClone(answer);
        const { container } = draw(plain);
        expect(container.querySelector(".fact-chart__svg")).not.toBeNull();
    });

    it("gives the host no shape that failed its check, and says it was withheld", () => {
        const { result } = changed((s) => void (points(s)[0].value += 0.01));
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        const { container } = draw(result, slot);
        expect(slot).not.toHaveBeenCalled();
        expect(screen.getByTestId("rich-shape-withheld")).toHaveTextContent("A chart was withheld");
        expect(container.querySelector(".fact-chart__svg")).toBeNull();
    });

    it("is accounted for: the panel takes it, so no other notice says it", () => {
        draw(answer);
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });

    it("says it when its claim has no table to sit on", () => {
        const { result } = changed((_, r) => void delete fact(r).rows);
        draw(result);
        expect(screen.getByTestId("render-shapes-not-drawn")).toHaveTextContent(treemap.title);
    });
});

describe("check 10: no treemap on an unrelated answer (CHAOS-12496)", () => {
    const fixtures = [
        ...Object.entries(cohortMemberScenarios),
        ...Object.entries(servedWordScenarios),
        ["category-order", servedShapeScenarios["category-order"]],
    ] as const;

    it.each(fixtures)("%s selects none", (_, result) => {
        expect(
            (result.render_shapes ?? []).filter((shape) => shape.kind === "treemap"),
        ).toHaveLength(0);
        expect(renderShapesFor(result, ["investment_theme_share"]).shapes).toHaveLength(0);
    });
});
