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

const answer = servedShapeScenarios["comparison-table"];
const table = answer.render_shapes!.find(
    (shape) => shape.selected_by === "comparison_side_by_side",
)!;

type Change = (shape: RenderShape, result: InvestigationResult) => void;

function changed(change: Change): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes!.find((s) => s.shape_id === table.shape_id)!;
    change(shape, result);
    return { shape, result };
}

const points = (shape: RenderShape, side = 0) => shape.series[side]!.points;
const factOf = (result: InvestigationResult, claimId: string | undefined) =>
    result.claimed_facts.find((fact) => fact.claim_id === claimId)!;
const first = (shape: RenderShape, result: InvestigationResult) =>
    factOf(result, points(shape)[0].source.claim_id);
const derivedInputs: NonNullable<InvestigationResult["claimed_facts"][number]["derived_from"]> = [
    { fact_id: "fact_one", field: "window_pr_count" },
    { fact_id: "fact_two", field: "window_pr_count" },
];
/** Sides up to `count`, each a copy of side two on a subject and claims of its own. */
function withSides(shape: RenderShape, result: InvestigationResult, count: number) {
    const sides = shape.series as RenderShape["series"][number][];
    const template = sides[1]!;
    for (let side = sides.length; side < count; side += 1) {
        const copy = structuredClone(template);
        copy.key = `repository:side-${String(side)}`;
        for (const point of copy.points) {
            const claim = structuredClone(factOf(result, point.source.claim_id));
            claim.claim_id = `${claim.claim_id}_${String(side)}`;
            claim.subject.canonical_id = copy.key;
            result.claimed_facts.push(claim);
            point.source.claim_id = claim.claim_id;
        }
        sides.push(copy);
    }
}
/** The row both sides hold: side two's claim is a real other measure, under the same label. */
function labelTwoFields(shape: RenderShape, result: InvestigationResult) {
    const label = points(shape, 0)[0].label;
    const other = points(shape, 1).find((point) => point.label === label)!;
    factOf(result, other.source.claim_id).field = "window_pr_count";
    other.source.field = "window_pr_count";
}

describe("the verifier reads a side-by-side table (CHAOS-12513)", () => {
    it("the fixture passes the result contract the server route holds it to", () => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            answer,
        );
        expect(verdict.errors ?? []).toEqual([]);
    });

    it("the fixture is the case: two sides, three measures, and a real gap", () => {
        expect(table.kind).toBe("table");
        expect(table.series).toHaveLength(2);
        expect(points(table, 0)).toHaveLength(3);
        expect(points(table, 1)).toHaveLength(2);
    });

    it("accepts the shape, with a gap", () => {
        expect(verifyRenderShape(table, answer)).toBe(true);
    });

    it("takes eight sides, the most a shape may hold, and refuses nine", () => {
        const eight = changed((s, r) => void withSides(s, r, 8));
        expect(verifyRenderShape(eight.shape, eight.result)).toBe(true);
        const nine = changed((s, r) => void withSides(s, r, 9));
        expect(verifyRenderShape(nine.shape, nine.result)).toBe(false);
    });

    it.each<[string, Change]>([
        ["a table under another rule", (s) => void (s.selected_by = "dated_fact_trend")],
        [
            "the rule on a series",
            (s) => {
                s.kind = "series";
                s.presentation = "bars";
            },
        ],
        ["a presentation", (s) => void (s.presentation = "bars")],
        ["the rule on another kind", (s) => void (s.kind = "treemap")],
        [
            "a value unit, on values it would allow",
            (s, r) => {
                s.value_unit = "ratio";
                for (const series of s.series) {
                    for (const point of series.points) {
                        point.value = 0.5;
                        factOf(r, point.source.claim_id).value = { number: 0.5 };
                    }
                }
            },
        ],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["an axis of another kind", (s) => void (s.axis_kind = "other" as never)],
        [
            "a point that cites a row, with the row's own value",
            (s) => {
                const point = points(s).find((p) => p.label === "Bus factor")!;
                point.source = { ...point.source, kind: "claimed_fact_row", row_index: 0 };
            },
        ],
        ["a side with no name", (s) => void (s.series[1]!.label = " ")],
        ["one side", (s) => void (s.series as unknown[]).pop()],
        ["a key that is not the subject", (s) => void (s.series[0].key = "repository:other")],
        [
            "a subject of another kind on one side",
            (s, r) => {
                for (const point of points(s, 1)) {
                    factOf(r, point.source.claim_id).subject.kind = "team";
                }
            },
        ],
        [
            "no label on every side",
            (s) => {
                for (const point of points(s, 1)) point.label = `${point.label} elsewhere`;
            },
        ],
        [
            "one label on two fact kinds",
            (s, r) => {
                const label = points(s, 0)[0].label;
                const other = points(s, 1).find((point) => point.label === label)!;
                factOf(r, other.source.claim_id).kind = "workload";
            },
        ],
        ["a field that is not the claim's", (s) => void (points(s)[0].source.field = "other")],
        ["a row index", (s) => void (points(s)[0].source.row_index = 0)],
        ["a subject on the source", (s) => void (points(s)[0].source.subject_canonical_id = "x")],
        ["a signal on the source", (s) => void (points(s)[0].source.signal = "x")],
        ["a value that is not the claim's", (s) => void (points(s)[0].value += 1)],
        [
            "a string claim that reads as the same number",
            (s, r) => void (first(s, r).value = { string: String(points(s)[0].value) }),
        ],
        ["a derived claim", (s, r) => void (first(s, r).derived_from = derivedInputs)],
        ["one label on two fields", (s, r) => void labelTwoFields(s, r)],
        ["a side with no point", (s) => void (s.series[1]!.points = [] as never)],
        [
            "a person on every side",
            (s, r) => {
                for (const series of s.series) {
                    for (const point of series.points) {
                        factOf(r, point.source.claim_id).subject.kind = "person";
                    }
                }
            },
        ],
        ["a claim this answer lacks", (s) => void (points(s)[0].source.claim_id = "claim_none")],
        ["two claims of one id", (s, r) => void r.claimed_facts.push(structuredClone(first(s, r)))],
        ["two labels the same", (s) => void (points(s)[1]!.label = points(s)[0].label)],
        [
            "an integer past the exact bound",
            (s, r) => {
                first(s, r).value = { integer: 2 ** 53 };
                points(s)[0].value = 2 ** 53;
            },
        ],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });
});

describe("a side-by-side table on the answer (CHAOS-12513)", () => {
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );
    const grid = () => within(screen.getByTestId("comparison-table")).getAllByRole("table")[0]!;
    const rowOf = (inside: HTMLElement, label: string) =>
        within(inside).getByRole("rowheader", { name: label }).closest("tr")!;
    const cells = (row: HTMLElement) =>
        within(row)
            .getAllByRole("cell")
            .map((cell) => cell.textContent);

    it("draws one visible table: a column per subject, a row per measure", () => {
        draw(answer);
        expect(grid()).toBeVisible();
        expect(grid().closest(".sr-only")).toBeNull();
        for (const series of table.series) {
            expect(within(grid()).getByRole("columnheader", { name: series.label })).toBeVisible();
        }
        const labels = new Set(table.series.flatMap((s) => s.points.map((point) => point.label)));
        expect(within(grid()).getAllByRole("rowheader")).toHaveLength(labels.size);
    });

    it("shows a measure one subject lacks as a gap, never as 0", () => {
        draw(answer);
        const lacking = points(table, 0).find(
            (point) => !points(table, 1).some((other) => other.label === point.label),
        )!;
        expect(cells(rowOf(grid(), lacking.label))).toEqual([String(lacking.value), "—"]);
    });

    it("rounds what it shows, and keeps the exact value in a closed fold", () => {
        draw(answer);
        const point = points(table, 0)[0];
        expect(point.value).toBe(1.9530555555555558);
        expect(cells(rowOf(grid(), point.label))[0]).toBe("1.95");
        const fold = screen.getByTestId("comparison-table-exact");
        expect(fold).not.toHaveAttribute("open");
        expect(cells(rowOf(within(fold).getByRole("table"), point.label))[0]).toBe(
            "1.9530555555555558",
        );
    });

    it("shows a real value near zero as itself, never as 0", () => {
        const { result } = changed((s, r) => {
            points(s)[0].value = 0.004;
            first(s, r).value = { number: 0.004 };
        });
        draw(result);
        expect(cells(rowOf(grid(), points(table, 0)[0].label))[0]).toBe("0.004");
    });

    it("has no fold when nothing rounds", () => {
        const { result } = changed((s, r) => {
            points(s)[0].value = 2;
            first(s, r).value = { integer: 2 };
            const other = points(s, 1)[0];
            other.value = 2;
            factOf(r, other.source.claim_id).value = { integer: 2 };
        });
        draw(result);
        expect(screen.queryByTestId("comparison-table-exact")).toBeNull();
    });

    it("needs no host chart, so the host is not asked", () => {
        const slot = vi.fn<ShapeSlot>(() => <div>chart</div>);
        draw(answer, slot);
        expect(slot).not.toHaveBeenCalled();
        expect(screen.queryByTestId("rich-shape-not-shown")).toBeNull();
    });

    it("withholds a table that fails its check, and says so", () => {
        const { result } = changed((s) => void (points(s)[0].value += 1));
        draw(result);
        expect(screen.queryByTestId("comparison-table")).toBeNull();
        expect(screen.getByTestId("comparison-table-withheld")).toHaveTextContent(
            "A table was withheld",
        );
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });

    it("counts two withheld tables", () => {
        const { result } = changed((s, r) => {
            points(s)[0].value += 1;
            r.render_shapes = [s, { ...structuredClone(s), shape_id: "rs_comparison_2" }] as never;
        });
        draw(result);
        expect(screen.getByTestId("comparison-table-withheld")).toHaveTextContent(
            "2 tables were withheld",
        );
    });

    it("is accounted for: no other notice says it", () => {
        draw(answer);
        expect(screen.queryByTestId("render-shapes-not-drawn")).toBeNull();
    });

    it("draws no panel on an answer with no such shape", () => {
        draw({ ...structuredClone(answer), render_shapes: [] });
        expect(screen.queryByTestId("comparison-table")).toBeNull();
        expect(screen.queryByTestId("comparison-table-withheld")).toBeNull();
    });
});

describe("check 10: no such table on an unrelated answer (CHAOS-12513)", () => {
    const fixtures = [
        ...Object.entries(cohortMemberScenarios),
        ...Object.entries(servedWordScenarios),
        ["category-order", servedShapeScenarios["category-order"]],
        ["investment-treemap", servedShapeScenarios["investment-treemap"]],
    ] as const;

    it.each(fixtures)("%s selects none", (_, result) => {
        expect(renderShapesFor(result, ["comparison_side_by_side"]).shapes).toHaveLength(0);
        expect((result.render_shapes ?? []).filter((s) => s.kind === "table")).toHaveLength(0);
    });
});
