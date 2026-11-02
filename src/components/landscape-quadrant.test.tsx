import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import { validateContract } from "@/lib/acr/validate";
import type { ClaimedFact, InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, verifyRenderShape } from "@/lib/render-shapes";
import { cohortMemberScenarios } from "@/test/fixtures/cohort-members";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";
import { servedWordScenarios } from "@/test/fixtures/served-words";

afterEach(cleanup);

/**
 * Teams placed on churn and delivery units on one day, through ACR's real selector (flag on), served
 * line, vocabulary labels, `Validate` and encoder (CHAOS-12624).
 */
const answer = servedShapeScenarios["landscape-quadrant"];
const quadrant = answer.render_shapes![0]!;

type Change = (shape: RenderShape, result: InvestigationResult) => void;

function changed(change: Change): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes![0]!;
    change(shape, result);
    return { shape, result };
}

type Point = RenderShape["series"][number]["points"][number];

const x = (shape: RenderShape) => shape.series[0];
const y = (shape: RenderShape) => shape.series[1]!;
const claim = (result: InvestigationResult, id: string | undefined): ClaimedFact =>
    result.claimed_facts.find((fact) => fact.claim_id === id)!;
/** The claim a point cites. */
const cited = (result: InvestigationResult, point: Point) => claim(result, point.source.claim_id);
const row = (fact: ClaimedFact) => fact.rows![0]!;

/** Moves one series to another field, in its claims, rows and tables too: only the key differs. */
function renameField(shape: RenderShape, result: InvestigationResult, index: 0 | 1, field: string) {
    const series = shape.series[index]!;
    for (const point of series.points) {
        const fact = cited(result, point);
        row(fact).fields[field] = row(fact).fields[fact.field]!;
        fact.field = field;
        fact.table = { ...fact.table!, measures: [...(fact.table!.measures ?? []), field] };
        point.source.field = field;
    }
    series.key = field;
}

/** Every claim's row, so a change to the day holds on both axes of every point. */
const everyRow = (result: InvestigationResult) => result.claimed_facts.map(row);

/** Sets one point's value, its claim's value and its row's cell. */
function setValue(shape: RenderShape, result: InvestigationResult, point: Point, value: number) {
    const fact = cited(result, point);
    point.value = value;
    fact.value = { integer: value };
    row(fact).fields[fact.field] = { integer: value };
    void shape;
}

describe("the verifier reads a quadrant as teams on one day (CHAOS-12624)", () => {
    it("the fixture is the case: four teams of four providers, a fifth left out, one day", () => {
        expect(quadrant.kind).toBe("quadrant");
        expect(quadrant.selected_by).toBe("landscape_position");
        expect(quadrant.series.map((item) => item.key)).toEqual([
            "churn_loc_30d",
            "delivery_units_30d",
        ]);
        expect(x(quadrant).points.map((point) => point.label)).toEqual([
            "Identity",
            "Delivery",
            "Payments",
            "Checkout",
        ]);
        expect(answer.subject_resolution.committed.map((subject) => subject.canonical_id)).toEqual([
            "team:gh:identity",
            "team:gl:chaos-gl",
            "team:jira:9a1f0c3e-0000-4000-8000-0000000d0001",
            "team:linear:CHK",
            "team:linear:MOB",
        ]);
        // A team with zero churn is a point at 0, never left out.
        expect(x(quadrant).points[2]!.value).toBe(0);
        const days = new Set(
            answer.claimed_facts.map((fact) => row(fact).fields.as_of_day?.string),
        );
        expect([...days]).toEqual(["2026-11-02"]);
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
        expect(verifyRenderShape(quadrant, answer)).toBe(true);
    });

    it("accepts two teams", () => {
        const { shape, result } = changed((s) => {
            for (const series of s.series) series.points = series.points.slice(0, 2) as never;
        });
        expect(verifyRenderShape(shape, result)).toBe(true);
    });

    it("accepts two teams that share a word in their claims but are named apart on the chart", () => {
        // The control for "a team placed twice": a second team, its own canonical id, is fine.
        const { shape, result } = changed((s, r) => {
            const twin = (point: Point, field: string): Point => {
                const fact = structuredClone(cited(r, point));
                fact.claim_id = `${fact.claim_id}_twin`;
                fact.fact_id = `${fact.fact_id!}_twin`;
                fact.subject = { ...fact.subject, canonical_id: "team:gh:twin", label: "Twin" };
                r.claimed_facts.push(fact);
                return {
                    ...point,
                    label: "Twin",
                    source: { ...point.source, claim_id: fact.claim_id, field },
                };
            };
            x(s).points.push(twin(x(s).points[0], "churn_loc_30d"));
            y(s).points.push(twin(y(s).points[0], "delivery_units_30d"));
        });
        expect(verifyRenderShape(shape, result)).toBe(true);
    });

    it.each<[string, Change]>([
        ["a quadrant under another rule", (s) => void (s.selected_by = "comparison_side_by_side")],
        ["the rule on another kind", (s) => void (s.kind = "table")],
        ["the rule on a series", (s) => void (s.kind = "series")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["a presentation", (s) => void (s.presentation = "bars")],
        ["a unit", (s) => void (s.value_unit = "ratio")],
        ["one series", (s) => void (s.series = [x(s)] as RenderShape["series"])],
        [
            "a third series",
            (s) => void (s.series = [x(s), y(s), { ...y(s), key: "identity_count" }] as never),
        ],
        [
            "the series swapped, with their words",
            (s) => {
                s.series = [y(s), x(s)] as RenderShape["series"];
                [s.axis_label, s.value_label] = [s.value_label, s.axis_label];
            },
        ],
        // Every other clause holds: the claims, rows and tables move with the key.
        ["x on a field not allowed", (s, r) => void renameField(s, r, 0, "x_norm")],
        ["y on a field not allowed", (s, r) => void renameField(s, r, 1, "y_norm")],
        ["a blank x word", (s) => void (x(s).label = s.axis_label = " ")],
        ["a blank y word", (s) => void (y(s).label = s.value_label = " ")],
        ["an axis word that is not x's", (s) => void (s.axis_label = "Churn")],
        ["a value word that is not y's", (s) => void (s.value_label = "Units")],
        [
            "one point",
            (s) => {
                for (const series of s.series) series.points = series.points.slice(0, 1) as never;
            },
        ],
        ["no point on y for a team", (s) => void y(s).points.pop()],
        [
            "one team under two words on x and y",
            (s, r) => {
                cited(r, y(s).points[0]).subject.label = "Identity Y";
                y(s).points[0].label = "Identity Y";
            },
        ],
        [
            "the labels in another order on y",
            (s) => {
                const [first, second, ...rest] = y(s).points;
                y(s).points = [second!, first, ...rest] as never;
            },
        ],
        [
            "a point of another source kind",
            (s) =>
                void (x(s).points[0].source = {
                    kind: "claimed_fact_row",
                    claim_id: x(s).points[0].source.claim_id!,
                    row_index: 0,
                    field: "churn_loc_30d",
                }),
        ],
        ["a claim of another kind", (s, r) => void (cited(r, x(s).points[0]).kind = "health")],
        [
            "x citing the team's y claim, whose row holds that value as churn too",
            (s, r) => {
                const point = x(s).points[0];
                point.source = { ...y(s).points[0].source };
                point.value = y(s).points[0].value;
                row(cited(r, point)).fields.churn_loc_30d = { integer: point.value };
            },
        ],
        [
            "a project's claims",
            (s, r) => {
                for (const point of [x(s).points[0], y(s).points[0]]) {
                    cited(r, point).subject.kind = "project";
                }
            },
        ],
        ["a negative value", (s, r) => void setValue(s, r, x(s).points[0], -5)],
        [
            "a derived claim",
            (s, r) =>
                void (cited(r, x(s).points[0]).derived_from = [
                    { fact_id: "fact_a", field: "churn_loc_30d" },
                    { fact_id: "fact_b", field: "churn_loc_30d" },
                ]),
        ],
        ["no declared table", (s, r) => void delete cited(r, x(s).points[0]).table],
        [
            "a table of another name",
            (s, r) => void (cited(r, x(s).points[0]).table!.field = "theme_breakdown"),
        ],
        [
            "two rows",
            (s, r) => {
                const fact = cited(r, x(s).points[0]);
                fact.rows = [row(fact), structuredClone(row(fact))];
            },
        ],
        ["no row", (s, r) => void (cited(r, x(s).points[0]).rows = [])],
        [
            "a table keyed by another column",
            (s, r) => void (cited(r, x(s).points[0]).table!.key = ["identity_count"]),
        ],
        [
            "a table keyed by two columns",
            (s, r) => void (cited(r, x(s).points[0]).table!.key = ["as_of_day", "identity_count"]),
        ],
        // Every row: a day missing from one row only differs from the others' day.
        ["rows with no day", (_, r) => everyRow(r).forEach((each) => delete each.fields.as_of_day)],
        [
            "rows with an empty day",
            (_, r) => everyRow(r).forEach((each) => void (each.fields.as_of_day = { string: "" })),
        ],
        [
            "a day that is not a string",
            (_, r) =>
                everyRow(r).forEach((each) => void (each.fields.as_of_day = { integer: 20261102 })),
        ],
        [
            "a measure the table does not declare",
            (s, r) => {
                const table = cited(r, x(s).points[0]).table!;
                table.measures = (table.measures ?? []).filter((m) => m !== "churn_loc_30d");
            },
        ],
        [
            "a cell that is a number, not an integer",
            (s, r) => void (row(cited(r, x(s).points[0])).fields.churn_loc_30d = { number: 18240 }),
        ],
        [
            "an integer cell that is not whole",
            (s, r) => {
                const point = x(s).points[0];
                point.value = 18240.5;
                cited(r, point).value = { integer: 18240.5 };
                row(cited(r, point)).fields.churn_loc_30d = { integer: 18240.5 };
            },
        ],
        [
            "a value that is not the row's cell",
            (s, r) =>
                void (row(cited(r, x(s).points[0])).fields.churn_loc_30d = { integer: 18241 }),
        ],
        [
            "a value that is not the claim's",
            (s, r) => void (cited(r, x(s).points[0]).value = { integer: 18241 }),
        ],
        [
            "a label that is not the team's",
            (s) => void (x(s).points[0].label = y(s).points[0].label = "Identity team"),
        ],
        [
            "an x and a y about two teams that share a word",
            (s, r) => {
                // Identity's point keeps its x and takes Delivery's y, whose claim says "Identity".
                const delivery = y(s).points[1]!;
                cited(r, delivery).subject.label = "Identity";
                y(s).points[0] = { ...delivery, label: "Identity" };
                for (const series of s.series) {
                    series.points = [series.points[0], ...series.points.slice(2)] as never;
                }
            },
        ],
        [
            "a team placed twice under two words",
            (s, r) => {
                const again = (point: Point): Point => {
                    const fact = structuredClone(cited(r, point));
                    fact.claim_id = `${fact.claim_id}_again`;
                    fact.subject = { ...fact.subject, label: "Identity (again)" };
                    r.claimed_facts.push(fact);
                    return {
                        ...point,
                        label: "Identity (again)",
                        source: { ...point.source, claim_id: fact.claim_id },
                    };
                };
                x(s).points.push(again(x(s).points[0]));
                y(s).points.push(again(y(s).points[0]));
            },
        ],
        [
            "a team on another day",
            (s, r) => {
                for (const point of [x(s).points[3]!, y(s).points[3]!]) {
                    row(cited(r, point)).fields.as_of_day = { string: "2026-11-01" };
                }
            },
        ],
        [
            "one point's x on another day",
            (s, r) =>
                void (row(cited(r, x(s).points[3]!)).fields.as_of_day = { string: "2026-11-01" }),
        ],
        [
            "one point's x and y on two days",
            (s, r) =>
                void (row(cited(r, y(s).points[3]!)).fields.as_of_day = { string: "2026-11-01" }),
        ],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("refuses a unit, even with values from 0 to 1", () => {
        const { shape, result } = changed((s, r) => {
            for (const series of s.series) series.points = series.points.slice(0, 2) as never;
            for (const [index, point] of [...x(s).points, ...y(s).points].entries()) {
                setValue(s, r, point, index % 2);
            }
        });
        expect(verifyRenderShape(shape, result), "the control: no unit").toBe(true);
        shape.value_unit = "ratio";
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("a served quadrant on the answer (CHAOS-12624)", () => {
    const NOT_SHOWN = "The chart is not shown here.";
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );
    const figure = () =>
        screen.getByText(quadrant.title, { selector: "figcaption" }).closest("figure")!;

    it("gives the host the verified shape, once", () => {
        const slot = vi.fn<ShapeSlot>(() => <div data-testid="host-chart">chart</div>);
        draw(answer, slot);
        expect(slot).toHaveBeenCalledTimes(1);
        expect(slot.mock.calls[0]?.[0].shape_id).toBe(quadrant.shape_id);
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
        expect(screen.getAllByTestId("landscape-quadrant")).toHaveLength(1);
    });

    it("shows the value table and the line with no host chart, in the served words", () => {
        draw(answer);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
        for (const word of ["Identity", "Delivery", "Payments", "Checkout", x(quadrant).label]) {
            expect(within(figure()).getAllByText(word)[0]).toBeVisible();
        }
        // The one-identity team gives no point, so the chart's table does not name it.
        expect(within(figure()).queryByText("Mobile")).toBeNull();
    });

    it("heads the value table's columns with the two measures' words, never x's word over teams", () => {
        draw(answer);
        const headers = within(figure())
            .getAllByRole("columnheader")
            .map((header) => header.textContent);
        expect(headers).toEqual(["", x(quadrant).label, y(quadrant).label]);
        expect(
            within(figure())
                .getAllByRole("rowheader")
                .map((cell) => cell.textContent),
        ).toEqual(["Identity", "Delivery", "Payments", "Checkout"]);
    });

    it("serves its one line: the chart locates the teams and does not explain them", () => {
        draw(answer);
        expect(
            screen.getByText(/It locates the teams; it does not explain why a team stands where/u),
        ).toBeInTheDocument();
    });

    it("gives the host no shape that failed its check, and says it was withheld", () => {
        const { result } = changed((s) => void (x(s).points[0].value = 18241));
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        draw(result, slot);
        expect(slot).not.toHaveBeenCalled();
        expect(screen.queryByTestId("landscape-quadrant")).toBeNull();
        expect(screen.getByTestId("landscape-quadrant-withheld")).toHaveTextContent(
            "A chart was withheld",
        );
    });

    it("is accounted for: its panel takes it, so no other notice says it", () => {
        draw(answer);
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });
});

describe("check 10: no quadrant on an unrelated answer (CHAOS-12624)", () => {
    const fixtures = [
        ...Object.entries(cohortMemberScenarios),
        ...Object.entries(servedWordScenarios),
        ...Object.entries(servedShapeScenarios).filter(([name]) => name !== "landscape-quadrant"),
    ] as const;

    it.each(fixtures)("%s selects none", (_, result) => {
        expect(
            (result.render_shapes ?? []).filter((shape) => shape.kind === "quadrant"),
        ).toHaveLength(0);
        expect(renderShapesFor(result, ["landscape_position"]).shapes).toHaveLength(0);
    });
});
