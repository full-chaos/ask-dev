import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import { validateContract } from "@/lib/acr/validate";
import type { ClaimedFactRow, InvestigationResult, RenderShape } from "@/lib/contracts";
import { renderShapesFor, SHARE_SUM_TOLERANCE, verifyRenderShape } from "@/lib/render-shapes";
import { cohortMemberScenarios } from "@/test/fixtures/cohort-members";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";
import { servedWordScenarios } from "@/test/fixtures/served-words";

afterEach(cleanup);

/** One team's repository → theme flow through ACR's real `Validate` and encoder (CHAOS-12579). */
const answer = servedShapeScenarios["repository-flow-sankey"];
const sankey = answer.render_shapes![0]!;

type Change = (shape: RenderShape, result: InvestigationResult) => void;

function changed(change: Change): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes![0]!;
    change(shape, result);
    return { shape, result };
}

const fact = (result: InvestigationResult) => result.claimed_facts[0]!;
const rows = (result: InvestigationResult) => fact(result).rows!;
const series = (shape: RenderShape, key: string) => shape.series.find((item) => item.key === key)!;
const setNumber = (row: ClaimedFactRow, field: string, value: number) =>
    void (row.fields[field] = { number: value });
const setString = (row: ClaimedFactRow, field: string, value: string) =>
    void (row.fields[field] = { string: value });

/**
 * A table of `count` repositories, each with one link of `effort` in feature delivery, and the
 * sankey that plots it, laid out as the fixture is. For the repository-count bounds only.
 */
function flowOf(count: number, effort = 1): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(answer);
    const shape = result.render_shapes![0]!;
    const template = rows(result)[0]!;
    const table: ClaimedFactRow[] = [];
    const points: RenderShape["series"][number]["points"][number][] = [];
    for (let index = 0; index < count; index += 1) {
        const row = structuredClone(template);
        const word = `acme/repo-${String(index)}`;
        setString(
            row,
            "repository",
            `repository:00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
        );
        setString(row, "repository_label", word);
        setNumber(row, "weighted_effort", effort);
        setNumber(row, "theme_weighted_effort", effort * count);
        table.push(row);
        points.push({
            label: word,
            value: effort,
            source: { ...shape.series[0].points[0].source, row_index: index },
        });
    }
    fact(result).rows = table;
    shape.series = [
        {
            ...series(shape, "feature_delivery"),
            points: points as RenderShape["series"][number]["points"],
        },
    ];
    return { shape, result };
}

/** Adds a feature-delivery link of 1e-14 to the table: inside the tolerance of its theme's sum. */
function addTinyLink(result: InvestigationResult): void {
    const tiny = structuredClone(rows(result)[0]!);
    setString(tiny, "repository", "repository:0b6f6a52-6c0e-4f7e-9d0b-3a1f2f6f0009");
    setString(tiny, "repository_label", "acme/tiny");
    setNumber(tiny, "weighted_effort", 1e-14);
    rows(result).push(tiny);
    for (const row of rows(result)) {
        if (row.fields.theme?.string === "feature_delivery") {
            setNumber(row, "theme_weighted_effort", 65 + 1e-14);
        }
    }
}

describe("the verifier reads a sankey as one team's flows (CHAOS-12579)", () => {
    it("the fixture is the case: a team claim, four themes, three repositories, a zero link", () => {
        expect(sankey.kind).toBe("sankey");
        expect(sankey.selected_by).toBe("investment_repository_flow");
        expect(fact(answer).subject.kind).toBe("team");
        expect(fact(answer).table?.field).toBe("repository_theme_breakdown");
        expect(sankey.series.map((item) => item.key)).toEqual([
            "feature_delivery",
            "operational",
            "maintenance",
            "quality",
        ]);
        expect(rows(answer).some((row) => row.fields.weighted_effort?.number === 0)).toBe(true);
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
        expect(verifyRenderShape(sankey, answer)).toBe(true);
    });

    it("accepts 2 and 64 repositories with effort", () => {
        for (const count of [2, 64]) {
            const { shape, result } = flowOf(count);
            expect(verifyRenderShape(shape, result), `${String(count)} repositories`).toBe(true);
        }
    });

    it(`takes a theme's sum within ${String(SHARE_SUM_TOLERANCE)} relative, and no further`, () => {
        const scaled = (factor: number) =>
            changed((_, r) => {
                for (const index of [0, 2]) {
                    setNumber(rows(r)[index]!, "theme_weighted_effort", 65 * factor);
                }
            });
        const near = scaled(1 + 1e-15);
        expect(verifyRenderShape(near.shape, near.result)).toBe(true);
        const far = scaled(1 + 1e-9);
        expect(verifyRenderShape(far.shape, far.result)).toBe(false);
    });

    it.each<[string, Change]>([
        ["a sankey under another rule", (s) => void (s.selected_by = "investment_theme_share")],
        ["the rule on another kind", (s) => void (s.kind = "treemap")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["a presentation", (s) => void (s.presentation = "bars")],
        ["a table of another name", (_, r) => void (fact(r).table!.field = "theme_breakdown")],
        ["no declared table", (_, r) => void delete fact(r).table],
        [
            "a table keyed by theme first",
            (_, r) => void (fact(r).table!.key = ["theme", "repository"]),
        ],
        ["a table with no repository word", (_, r) => void (fact(r).table!.observations = [])],
        [
            "a time series on the claim, even with the same rows",
            (_, r) => void (fact(r).time_series_rows = structuredClone(rows(r))),
        ],
        ["a project's claim", (_, r) => void (fact(r).subject.kind = "project")],
        ["a table of another shape", (_, r) => void (fact(r).table!.shape = "ranking")],
        [
            "a table keyed by the repository alone",
            (_, r) => void (fact(r).table!.key = ["repository"]),
        ],
        [
            "a table keyed by three columns",
            (_, r) => void (fact(r).table!.key = ["repository", "theme", "source"]),
        ],
        [
            "a table keyed by the repository, then not the theme",
            (_, r) => void (fact(r).table!.key = ["repository", "source"]),
        ],
        [
            "a table keyed by the theme second, after not the repository",
            (_, r) => void (fact(r).table!.key = ["source", "theme"]),
        ],
        [
            "a row whose word is a number",
            (_, r) => void setNumber(rows(r)[3]!, "repository_label", 1),
        ],
        [
            "a row whose theme is a number, with no effort in it",
            (_, r) => {
                setNumber(rows(r)[3]!, "theme", 3);
                setNumber(rows(r)[3]!, "theme_weighted_effort", 0);
            },
        ],
        [
            "a row whose theme effort is not a number, alone in its theme",
            (_, r) => {
                setString(rows(r)[3]!, "theme", "risk");
                setString(rows(r)[3]!, "theme_weighted_effort", "0");
            },
        ],
        [
            "a row not drawn that disagrees on its theme's effort",
            (_, r) => void setNumber(rows(r)[3]!, "theme_weighted_effort", 13),
        ],
        [
            "an extra empty series",
            (s) =>
                void (s.series as unknown[]).push({
                    key: "risk",
                    label: "Risk / Security",
                    points: [],
                }),
        ],
        [
            "a table with no link effort",
            (_, r) => void (fact(r).table!.measures = ["theme_weighted_effort"]),
        ],
        [
            "a table with no theme effort",
            (_, r) => void (fact(r).table!.measures = ["weighted_effort"]),
        ],
        // Rows not drawn (zero effort), so only the row's own clause can refuse them.
        ["a row with no repository", (_, r) => void delete rows(r)[3]!.fields.repository],
        [
            "a row with no repository word",
            (_, r) => void delete rows(r)[3]!.fields.repository_label,
        ],
        ["a row with no theme", (_, r) => void delete rows(r)[3]!.fields.theme],
        [
            "a row whose effort is not a number",
            (_, r) => void setString(rows(r)[3]!, "weighted_effort", "0"),
        ],
        [
            "a row whose theme effort is not a number",
            (_, r) => void setString(rows(r)[3]!, "theme_weighted_effort", "12.5"),
        ],
        [
            "a negative theme effort",
            (_, r) => {
                setString(rows(r)[3]!, "theme", "risk");
                setNumber(rows(r)[3]!, "theme_weighted_effort", -1);
            },
        ],
        [
            "a repository with a blank word",
            (_, r) => {
                const blank = structuredClone(rows(r)[3]!);
                setString(blank, "repository", "repository:0b6f6a52-6c0e-4f7e-9d0b-3a1f2f6f0008");
                setString(blank, "repository_label", " ");
                rows(r).push(blank);
            },
        ],
        // No person node: a node that is not a repository.
        // Row 3 is acme/api's zero link: a node no other clause sees.
        ["a person as a node", (_, r) => void setString(rows(r)[3]!, "repository", "person:alice")],
        [
            "a node with an empty repository id",
            (_, r) => void setString(rows(r)[3]!, "repository", "repository:"),
        ],
        // No self link: a repository named with a theme's word joins that theme to itself.
        [
            "a repository named with a theme's word",
            (s, r) => {
                for (const index of [2, 3, 4]) {
                    setString(rows(r)[index]!, "repository_label", "Feature Delivery");
                }
                series(s, "feature_delivery").points[1]!.label = "Feature Delivery";
                series(s, "operational").points[0].label = "Feature Delivery";
            },
        ],
        [
            "two repositories with one word",
            (s, r) => {
                for (const index of [5, 6])
                    setString(rows(r)[index]!, "repository_label", "acme/api");
                series(s, "maintenance").points[0].label = "acme/api";
                series(s, "quality").points[1]!.label = "acme/api";
            },
        ],
        [
            "one repository with two words",
            (s, r) => {
                setString(rows(r)[1]!, "repository_label", "acme/www");
                series(s, "quality").points[0].label = "acme/www";
            },
        ],
        [
            "a sum outside the tolerance",
            (_, r) => {
                for (const index of [0, 2]) {
                    setNumber(rows(r)[index]!, "theme_weighted_effort", 65 * (1 + 1e-9));
                }
            },
        ],
        [
            "rows that disagree on a theme's effort",
            (_, r) => void setNumber(rows(r)[2]!, "theme_weighted_effort", 66),
        ],
        [
            "a theme with effort and no link",
            (_, r) => {
                setString(rows(r)[3]!, "theme", "risk");
                setNumber(rows(r)[3]!, "theme_weighted_effort", 3);
            },
        ],
        [
            "a negative effort in a row not drawn",
            (_, r) => void setNumber(rows(r)[3]!, "weighted_effort", -1),
        ],
        [
            "a theme left out",
            (s) =>
                void (s.series = s.series.filter(
                    (item) => item.key !== "operational",
                ) as RenderShape["series"]),
        ],
        [
            "a series that is no theme with effort",
            (s) => void (series(s, "operational").key = "risk"),
        ],
        ["a theme with no word", (s) => void (series(s, "operational").label = " ")],
        ["a link left out within the tolerance", (_, r) => void addTinyLink(r)],
        [
            "a zero link drawn in place of a tiny link left out",
            (s, r) => {
                addTinyLink(r);
                series(s, "maintenance").points.push({
                    label: "acme/api",
                    value: 0,
                    source: { ...series(s, "maintenance").points[0].source, row_index: 3 },
                });
            },
        ],
        [
            "a zero link drawn",
            (s) => {
                const zero = { ...series(s, "maintenance").points[0] };
                series(s, "maintenance").points.push({
                    label: "acme/api",
                    value: 0,
                    source: { ...zero.source, row_index: 3 },
                });
            },
        ],
        [
            "a link under another theme's series",
            (s) => {
                const moved = series(s, "quality").points.shift()!;
                series(s, "feature_delivery").points.push(moved);
            },
        ],
        [
            "a link labelled with another word",
            (s) => void (series(s, "operational").points[0].label = "acme/other"),
        ],
        [
            "a value that is not the cell's",
            (s) => void (series(s, "operational").points[0].value = 5.5),
        ],
        [
            "a point on another field",
            (s) => void (series(s, "operational").points[0].source.field = "theme_weighted_effort"),
        ],
        [
            "a point of another kind",
            (s) => void (series(s, "operational").points[0].source.kind = "claimed_fact_value"),
        ],
        [
            "a point on another claim",
            (s, r) => {
                r.claimed_facts.push({ ...structuredClone(fact(r)), claim_id: "claim_other_one" });
                series(s, "operational").points[0].source.claim_id = "claim_other_one";
            },
        ],
    ])("refuses %s", (_, change) => {
        const { shape, result } = changed(change);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("refuses a unit: weighted effort is not a ratio, even with values from 0 to 1", () => {
        const { shape, result } = flowOf(2, 0.5);
        expect(verifyRenderShape(shape, result)).toBe(true);
        shape.value_unit = "ratio";
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("refuses links drawn under each other's themes, even when every sum still holds", () => {
        const { shape, result } = flowOf(2, 5);
        // The second repository's link is quality's, with its own theme effort.
        setString(rows(result)[1]!, "theme", "quality");
        setNumber(rows(result)[0]!, "theme_weighted_effort", 5);
        setNumber(rows(result)[1]!, "theme_weighted_effort", 5);
        const [first, second] = shape.series[0].points;
        const quality = { key: "quality", label: "Quality / Reliability" };
        shape.series = [
            { ...shape.series[0], points: [first] },
            { ...quality, points: [second!] },
        ];
        expect(verifyRenderShape(shape, result), "the control: each link under its theme").toBe(
            true,
        );
        shape.series = [
            { ...shape.series[0], points: [second!] },
            { ...quality, points: [first] },
        ];
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("refuses 1 and 65 repositories with effort: never an 'other' node", () => {
        for (const count of [1, 65]) {
            const { shape, result } = flowOf(count);
            expect(verifyRenderShape(shape, result), `${String(count)} repositories`).toBe(false);
        }
    });
});

describe("a served sankey on the answer (CHAOS-12579)", () => {
    const NOT_SHOWN = "The chart is not shown here.";
    const draw = (result: InvestigationResult, slot: ShapeSlot | null = null) =>
        render(
            <ShapeSlotContext.Provider value={slot}>
                <DeterministicAnswerView offersPresentation="popup" result={result} />
            </ShapeSlotContext.Provider>,
        );
    const figure = () =>
        screen.getByText(sankey.title, { selector: "figcaption" }).closest("figure")!;

    it("gives the host the verified shape, once", () => {
        const slot = vi.fn<ShapeSlot>(() => <div data-testid="host-chart">chart</div>);
        draw(answer, slot);
        expect(slot).toHaveBeenCalledTimes(1);
        expect(slot.mock.calls[0]?.[0].shape_id).toBe(sankey.shape_id);
        expect(screen.getByTestId("host-chart")).toBeVisible();
        expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });

    it("shows the value table and the line with no host chart, in the served words", () => {
        draw(answer);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
        for (const word of ["acme/web", "acme/api", "acme/infra", "Feature Delivery"]) {
            expect(within(figure()).getAllByText(word)[0]).toBeVisible();
        }
    });

    it("shows the value table and the line when the slot returns null", () => {
        draw(answer, () => null);
        expect(within(figure()).getByText(NOT_SHOWN)).toBeVisible();
    });

    it("gives the host no shape that failed its check, and says it was withheld", () => {
        const { result } = changed((s) => void (series(s, "operational").points[0].value = 5.5));
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

describe("check 10: no sankey on an unrelated answer (CHAOS-12579)", () => {
    const fixtures = [
        ...Object.entries(cohortMemberScenarios),
        ...Object.entries(servedWordScenarios),
        ["investment-treemap", servedShapeScenarios["investment-treemap"]],
    ] as const;

    it.each(fixtures)("%s selects none", (_, result) => {
        expect(
            (result.render_shapes ?? []).filter((shape) => shape.kind === "sankey"),
        ).toHaveLength(0);
        expect(renderShapesFor(result, ["investment_repository_flow"]).shapes).toHaveLength(0);
    });
});
