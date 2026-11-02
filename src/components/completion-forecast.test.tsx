import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, shapeDetail, verifyRenderShape } from "@/lib/render-shapes";
import { shapesNoPanelTakes } from "@/lib/shape-account";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";
import curveDetail from "@/test/fixtures/served-shapes/forecast-curve.detail.json";

afterEach(cleanup);

// CHAOS-4613: acr's completion forecast. Each fixture is a stored forecast row through acr's real
// fact writer, claim attach, summary, selector and encoder (`served-shapes/generate-forecast.go.txt`).
const curveAnswer = servedShapeScenarios["forecast-curve"];
const noRunAnswer = servedShapeScenarios["forecast-no-run"];
const notStoredAnswer = servedShapeScenarios["forecast-not-stored"];
const curve = curveAnswer.render_shapes![0]!;

type Change = (shape: RenderShape, result: InvestigationResult) => void;

function changed(
    change: Change,
    answer: InvestigationResult = curveAnswer,
): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes![0]!;
    change(shape, result);
    return { shape, result };
}

const points = (shape: RenderShape) => shape.series[0].points;
const fact = (result: InvestigationResult) => result.claimed_facts[0]!;
const summary = (result: InvestigationResult) => fact(result).completion_forecast!;

describe("the verifier reads a forecast as one claim's whole distribution (CHAOS-4613)", () => {
    it("the fixture is the case: a served curve whose last point is the horizon bin", () => {
        expect(curve.kind).toBe("forecast");
        expect(curve.selected_by).toBe("completion_forecast");
        expect(curve.value_unit).toBe("ratio");
        expect(points(curve).map((point) => point.label)).toEqual([
            "9",
            "12",
            "15",
            "21",
            "30",
            "365",
        ]);
        expect(summary(curveAnswer)).toMatchObject({
            state: "available",
            horizon_days: 365,
            unfinished_runs: 500,
        });
    });

    it.each([
        ["forecast-curve", curveAnswer],
        ["forecast-no-run", noRunAnswer],
        ["forecast-not-stored", notStoredAnswer],
    ])("%s passes the result contract the server route holds it to", (_, answer) => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            answer,
        );
        expect(verdict.errors ?? []).toEqual([]);
        expect(verdict.valid).toBe(true);
    });

    it("accepts the served curve, with the horizon bin as its last point", () => {
        expect(verifyRenderShape(curve, curveAnswer)).toBe(true);
    });

    it.each<[string, Change]>([
        ["a forecast under another rule", (s) => void (s.selected_by = "dated_fact_trend")],
        [
            "the rule on a series",
            (s) => {
                s.kind = "series";
                s.presentation = "line";
            },
        ],
        ["a presentation", (s) => void (s.presentation = "line")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["no unit", (s) => void delete s.value_unit],
        [
            "two series",
            (s) => void (s.series as unknown[]).push({ ...s.series[0], key: "cumulative_share_2" }),
        ],
        ["a series of another key", (s) => void (s.series[0].key = "runs")],
        ["a table of another name", (_, r) => void (fact(r).table!.field = "daily_workload")],
        ["a table of another shape", (_, r) => void (fact(r).table!.shape = "breakdown")],
        ["a table of another key", (_, r) => void (fact(r).table!.key = ["day"])],
        ["a table that declares no share", (_, r) => void (fact(r).table!.measures = ["runs"])],
        ["no declared table", (_, r) => void delete fact(r).table],
        [
            "a summary that is not available",
            (_, r) => void (summary(r).state = "no_run_within_horizon"),
        ],
        ["no summary", (_, r) => void delete fact(r).completion_forecast],
        ["a summary with no horizon", (_, r) => void delete summary(r).horizon_days],
        [
            "every share 0",
            (s, r) => {
                for (const [index, point] of points(s).entries()) {
                    point.value = 0;
                    fact(r).rows![index]!.fields.cumulative_share = { number: 0 };
                }
            },
        ],
        ["a row left out", (s) => void (s.series[0].points as unknown[]).pop()],
        [
            "points out of row order",
            (s) => {
                const [first, second] = [points(s)[0], points(s)[1]!];
                points(s)[0] = second;
                points(s)[1] = first;
            },
        ],
        ["a label that is not its row's day", (s) => void (points(s)[1]!.label = "13")],
        [
            "a day that is not an integer",
            (_, r) => void (fact(r).rows![1]!.fields.completion_days = { number: 12 }),
        ],
        [
            "a point of another kind on the same cell",
            (s) => void (points(s)[0].source.kind = "claimed_fact_row"),
        ],
        [
            "a point on another field, even with the same value",
            (s, r) => {
                const row = fact(r).rows![0]!;
                row.fields.share_copy = row.fields.cumulative_share!;
                points(s)[0].source.field = "share_copy";
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
            "a day at or past the horizon that is not the last point",
            (_, r) => void (summary(r).horizon_days = 21),
        ],
        ["a value that is not the row's", (s) => void (points(s)[0].value += 0.01)],
        ["two labels the same", (s) => void (points(s)[1]!.label = points(s)[0].label)],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("the verifier reads the percentiles table as its claims' own percentiles (CHAOS-4613)", () => {
    it("accepts two stored forecasts of one team, one series each", () => {
        const { shape, result } = changed((s, r) => {
            const other = structuredClone(fact(r));
            other.claim_id = "claim_other_scope";
            other.completion_forecast!.work_scope_id = "linear:OTHER";
            r.claimed_facts.push(other);
            const again = structuredClone(s.series[0]);
            again.key = "claim_other_scope";
            for (const point of again.points) point.source.claim_id = "claim_other_scope";
            (s.series as unknown[]).push(again);
        }, notStoredAnswer);
        expect(verifyRenderShape(shape, result)).toBe(true);
    });

    it.each([
        ["every run at the horizon", noRunAnswer],
        ["no stored distribution", notStoredAnswer],
    ])("accepts the served table: %s", (_, answer) => {
        const table = answer.render_shapes![0]!;
        expect(table.kind).toBe("table");
        expect(table.selected_by).toBe("completion_forecast_percentiles");
        expect(verifyRenderShape(table, answer)).toBe(true);
    });

    it.each<[string, Change]>([
        [
            "a percentile cited to a row",
            (s) => void (points(s)[0].source.kind = "claimed_fact_row"),
        ],
        [
            "a summary field that is not a percentile",
            (s, r) => {
                points(s)[0].source.field = "simulation_count";
                points(s)[0].value = summary(r).simulation_count!;
            },
        ],
        [
            "a series on two claims",
            (s, r) => {
                r.claimed_facts.push({ ...structuredClone(fact(r)), claim_id: "claim_other_one" });
                points(s)[1]!.source.claim_id = "claim_other_one";
            },
        ],
        [
            "two claims of one stored forecast in two series",
            (s, r) => {
                r.claimed_facts.push({ ...structuredClone(fact(r)), claim_id: "claim_same_scope" });
                const again = structuredClone(s.series[0]);
                again.key = "claim_same_scope";
                for (const point of again.points) point.source.claim_id = "claim_same_scope";
                (s.series as unknown[]).push(again);
            },
        ],
        [
            "a series whose claim carries no summary",
            (_, r) => void delete fact(r).completion_forecast,
        ],
        [
            "one claim in two series",
            (s) =>
                void (s.series as unknown[]).push({
                    ...structuredClone(s.series[0]),
                    key: "again",
                }),
        ],
        ["a unit", (s) => void (s.value_unit = "ratio")],
        ["a presentation", (s) => void (s.presentation = "bars")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["a value that is not the summary's", (s) => void (points(s)[0].value += 1)],
        [
            "a percentile the summary does not carry",
            (_, r) => void delete summary(r).forecast_p95_days,
        ],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change, notStoredAnswer);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("the host gets the forecast's served detail (CHAOS-4613)", () => {
    it("the claim's summary and each point's own row: day, runs and share", () => {
        const detail = shapeDetail(curve, curveAnswer.claimed_facts);
        expect(detail?.kind).toBe("forecast");
        expect(detail?.summary).toEqual(summary(curveAnswer));
        expect(detail?.rows).toEqual(
            fact(curveAnswer).rows!.map((row) => ({
                day: row.fields.completion_days!.integer,
                runs: row.fields.runs!.integer,
                cumulativeShare: row.fields.cumulative_share!.number,
            })),
        );
    });

    it("the published detail fixture is exactly what the host gets: a host reads it from the pin", () => {
        expect(shapeDetail(curve, curveAnswer.claimed_facts)).toEqual(curveDetail);
    });

    it("leaves a run count the row does not carry absent, never 0", () => {
        const { shape, result } = changed((_, r) => void delete fact(r).rows![0]!.fields.runs);
        expect(shapeDetail(shape, result.claimed_facts)?.rows[0]).toEqual({
            day: 9,
            cumulativeShare: 0.1,
        });
    });

    it("gives no detail for a shape that needs none", () => {
        expect(shapeDetail(noRunAnswer.render_shapes![0]!, noRunAnswer.claimed_facts)).toBe(
            undefined,
        );
    });
});

describe("a served forecast on the answer (CHAOS-4613)", () => {
    const NOT_SHOWN = "The chart is not shown here.";
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );
    const figure = () =>
        screen.getByText(curve.title, { selector: "figcaption" }).closest("figure")!;

    it("draws the host's chart once, with the shape and its served detail", () => {
        const slot = vi.fn<ShapeSlot>(() => <div data-testid="host-chart">chart</div>);
        draw(curveAnswer, slot);
        expect(slot).toHaveBeenCalledTimes(1);
        const [shape, detail] = slot.mock.calls[0]!;
        expect(shape.shape_id).toBe(curve.shape_id);
        expect(detail).toEqual(shapeDetail(curve, curveAnswer.claimed_facts));
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });

    it("shows the value table and the line with no host chart, as standalone does", () => {
        draw(curveAnswer);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
        for (const point of points(curve)) {
            expect(within(figure()).getAllByText(point.label)[0]).toBeVisible();
        }
    });

    it("replaces the fallback chart for that fact: the two never draw together", () => {
        const { container } = draw(curveAnswer, () => <div>chart</div>);
        expect(container.querySelector(".fact-chart__svg")).toBeNull();
    });

    it("gives the host no shape that failed its check, and says it was withheld", () => {
        const { result } = changed((s) => void (points(s)[0].value += 0.01));
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        draw(result, slot);
        expect(slot).not.toHaveBeenCalled();
        expect(screen.getByTestId("forecast-shape-withheld")).toHaveTextContent(
            "A completion forecast chart was withheld",
        );
    });

    it.each([
        ["forecast-curve", curveAnswer],
        ["forecast-no-run", noRunAnswer],
        ["forecast-not-stored", notStoredAnswer],
    ])("is accounted for (%s): a panel takes it, so no other notice says it", (_, answer) => {
        expect(shapesNoPanelTakes(answer)).toEqual([]);
        draw(answer);
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });
});

describe("the percentiles table when no curve is drawn (CHAOS-4613)", () => {
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );

    it.each([
        [
            "every run at the horizon",
            noRunAnswer,
            "No simulated run finished within the forecast horizon",
        ],
        ["no stored distribution", notStoredAnswer, "No distribution stored for this forecast"],
    ])("draws the served days and says why there is no curve: %s", (_, answer, why) => {
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        draw(answer, slot);
        const panel = screen.getByTestId("forecast-percentiles");
        const table = answer.render_shapes![0]!;
        for (const point of table.series[0].points) {
            expect(within(panel).getByText(point.label)).toBeVisible();
            expect(within(panel).getAllByText(String(point.value))[0]).toBeVisible();
        }
        expect(within(panel).getByTestId("forecast-percentiles-states")).toHaveTextContent(
            `${table.series[0].label}: ${why}`,
        );
        // The table is the view: no host chart is asked for, and no curve is drawn.
        expect(slot).not.toHaveBeenCalled();
        expect(screen.queryByText(curve.title, { selector: "figcaption" })).toBeNull();
    });

    it("says a table that failed its check was withheld", () => {
        const { result } = changed((s) => void (points(s)[0].value += 1), notStoredAnswer);
        draw(result);
        expect(screen.queryByTestId("forecast-percentiles")).toBeNull();
        expect(screen.getByTestId("forecast-percentiles-withheld")).toHaveTextContent(
            "A table was withheld",
        );
    });

    it("says no state for a scope whose distribution is available", () => {
        const { result } = changed(
            (_, r) => void (summary(r).state = "available"),
            notStoredAnswer,
        );
        draw(result);
        expect(screen.getByTestId("forecast-percentiles")).toBeVisible();
        expect(screen.queryByTestId("forecast-percentiles-states")).toBeNull();
    });
});

describe("check 10: no forecast on an unrelated answer (CHAOS-4613)", () => {
    const fixtures = Object.entries(servedShapeScenarios).filter(
        ([name]) => !name.startsWith("forecast-"),
    );

    it.each(fixtures)("%s selects none", (_, result) => {
        expect(
            renderShapesFor(result, ["completion_forecast", "completion_forecast_percentiles"])
                .shapes,
        ).toHaveLength(0);
    });
});
