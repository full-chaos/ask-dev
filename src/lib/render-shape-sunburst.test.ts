import { describe, expect, it } from "vitest";

import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import {
    FACT_PANEL_RULES,
    SUBCATEGORY_SHARE_RULE,
    renderShapesFor,
    verifyRenderShape,
} from "@/lib/render-shapes";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

/**
 * CHAOS-12812: the investment sunburst, held to what ACR's `validateSunburstShape` holds it to
 * (acr #1930, CHAOS-12588). The fixture is a served answer from ACR's real vocabulary labels,
 * `Validate` and encoder (`served-shapes/generate-sunburst.go.txt`). Each refusal plants the defect
 * one clause exists to catch.
 */

const served = servedShapeScenarios["investment-sunburst"];

type Series = RenderShape["series"][number];
type Point = Series["points"][number];
type Edit = (shape: RenderShape, result: InvestigationResult) => void;

function changed(edit: Edit): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(served);
    const shape = result.render_shapes![0]!;
    edit(shape, result);
    return { shape, result };
}

const series = (shape: RenderShape, key: string): Series => {
    const found = shape.series.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`no series ${key}`);
    return found;
};
const rows = (result: InvestigationResult) => result.claimed_facts[0]!.rows!;
const rowIndex = (result: InvestigationResult, subcategory: string): number => {
    const index = rows(result).findIndex((row) => row.fields.subcategory?.string === subcategory);
    if (index < 0) throw new Error(`no row ${subcategory}`);
    return index;
};
const cell = (result: InvestigationResult, subcategory: string) =>
    rows(result)[rowIndex(result, subcategory)]!.fields;
/** The point of a ring that cites a subcategory's row. */
const pointOf = (shape: RenderShape, result: InvestigationResult, subcategory: string): Point => {
    const index = rowIndex(result, subcategory);
    const theme = subcategory.split(".")[0]!;
    const found = series(shape, theme).points.find((point) => point.source.row_index === index);
    if (found === undefined) throw new Error(`no point ${subcategory}`);
    return found;
};
/** Sets a subcategory's share on its row and on the point that cites it. */
const setShare = (shape: RenderShape, result: InvestigationResult, sub: string, value: number) => {
    cell(result, sub).share = { number: value };
    pointOf(shape, result, sub).value = value;
};
/** Serves each ring's label as its theme's word, as ACR's label registry does for a theme it uses. */
const withThemeWords = (shape: RenderShape, result: InvestigationResult) => {
    result.vocabulary_labels = { ...result.vocabulary_labels };
    for (const ring of shape.series) {
        if (ring.key !== "themes")
            result.vocabulary_labels[`investment_theme:${ring.key}`] = ring.label;
    }
};

describe("the sunburst verifier mirrors acr's validateSunburstShape (CHAOS-12812)", () => {
    it("the fixture is the case: two rings over five themes and fifteen subcategories", () => {
        const shape = served.render_shapes![0]!;
        expect(shape.selected_by).toBe(SUBCATEGORY_SHARE_RULE);
        expect(shape.kind).toBe("sunburst");
        expect(shape.series.map((entry) => entry.key)).toEqual([
            "themes",
            "feature_delivery",
            "maintenance",
            "operational",
            "quality",
            "risk",
        ]);
        expect(rows(served)).toHaveLength(15);
        expect(served.vocabulary_labels?.["subcategory:quality.bugfix"]).toBe("Bugfix");
    });

    it("the fixture passes the result contract the server route holds it to", () => {
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            served,
        );
        expect(verdict.errors ?? []).toEqual([]);
        expect(verdict.valid).toBe(true);
    });

    it("accepts the served sunburst, and its fact's panel takes it", () => {
        expect(verifyRenderShape(served.render_shapes![0]!, served)).toBe(true);
        expect(FACT_PANEL_RULES).toContain(SUBCATEGORY_SHARE_RULE);
        const verdict = renderShapesFor(served, [SUBCATEGORY_SHARE_RULE]);
        expect(verdict.shapes).toHaveLength(1);
        expect(verdict.withheld).toBe(0);
    });

    it("accepts a claim that names the detail table with no value, as a producer serves it", () => {
        const { shape, result } = changed((_, r) => {
            const claim = r.claimed_facts[0]! as { field: string; value?: unknown };
            claim.field = "subcategory_breakdown";
            delete claim.value;
        });
        expect(verifyRenderShape(shape, result)).toBe(true);
    });

    it("accepts the served theme words, and a sum within the tolerance", () => {
        expect(verifyRenderShape(...pair(changed(withThemeWords)))).toBe(true);
        // 1 ULP of float noise on a part is not a disagreement (lead ruling on CHAOS-12554).
        const near = changed((s, r) => setShare(s, r, "risk.security", 0.05 + 1e-17));
        expect(verifyRenderShape(near.shape, near.result)).toBe(true);
    });

    it.each<[string, Edit]>([
        [
            "the rule on another kind",
            (s) => {
                s.kind = "series";
                s.presentation = "bars";
            },
        ],
        ["a sunburst under another rule", (s) => void (s.selected_by = "investment_theme_share")],
        ["a time axis", (s) => void (s.axis_kind = "time")],
        ["no ratio unit", (s) => void delete s.value_unit],
        ["a presentation", (s) => void (s.presentation = "bars")],
        [
            "an undeclared table",
            (_, r) => void (r.claimed_facts[0]!.table!.field = "theme_breakdown"),
        ],
        [
            "a table with no theme_share measure",
            (_, r) => void (r.claimed_facts[0]!.table!.measures = ["share"]),
        ],
        [
            "a table with no theme observation",
            (_, r) => void (r.claimed_facts[0]!.table!.observations = []),
        ],
        [
            "a cut table",
            (s, r) => {
                const index = rowIndex(r, "risk.vulnerability");
                rows(r).splice(index, 1);
                const ring = series(s, "risk");
                ring.points.splice(
                    ring.points.findIndex((point) => point.source.row_index === index),
                    1,
                );
            },
        ],
        [
            "a row under another theme",
            (_, r) => void (cell(r, "risk.vulnerability").theme = { string: "quality" }),
        ],
        [
            "a repeated subcategory",
            (_, r) =>
                void (cell(r, "risk.vulnerability").subcategory = { string: "risk.compliance" }),
        ],
        [
            "a row with no theme share",
            (_, r) => void delete cell(r, "risk.vulnerability").theme_share,
        ],
        [
            "two theme shares for one theme",
            (_, r) => void (cell(r, "risk.security").theme_share = { number: 0.06 }),
        ],
        ["a kind the rule does not name", (s) => void (s.kind = "treemap")],
        ["a claim with no table", (_, r) => void delete r.claimed_facts[0]!.table],
        [
            "a table with time series rows",
            (_, r) => void (r.claimed_facts[0]!.time_series_rows = [rows(r)[0]!]),
        ],
        [
            "a table of another shape",
            (_, r) => void (r.claimed_facts[0]!.table!.shape = "distribution"),
        ],
        [
            "a table keyed by two columns",
            (_, r) => void (r.claimed_facts[0]!.table!.key = ["subcategory", "theme"]),
        ],
        [
            "a table keyed by another column",
            (_, r) => void (r.claimed_facts[0]!.table!.key = ["theme"]),
        ],
        [
            "a table with no share measure",
            (_, r) => void (r.claimed_facts[0]!.table!.measures = ["theme_share"]),
        ],
        [
            "a row with no subcategory",
            (_, r) => void delete cell(r, "risk.vulnerability").subcategory,
        ],
        [
            "a subcategory token with no dot",
            (_, r) => void (cell(r, "risk.vulnerability").subcategory = { string: "risks" }),
        ],
        [
            "two rows whose themes are swapped",
            (s, r) => {
                // risk.vulnerability and quality.reliability (both share 0) swap their theme and
                // theme_share cells and their rings: every count, sum and ring agrees with the
                // cells, and only the token's own theme disagrees.
                const vulnerability = cell(r, "risk.vulnerability");
                const reliability = cell(r, "quality.reliability");
                [vulnerability.theme, reliability.theme] = [
                    reliability.theme!,
                    vulnerability.theme!,
                ];
                [vulnerability.theme_share, reliability.theme_share] = [
                    reliability.theme_share!,
                    vulnerability.theme_share!,
                ];
                const risk = series(s, "risk");
                const quality = series(s, "quality");
                const a = risk.points.indexOf(pointOf(s, r, "risk.vulnerability"));
                const b = quality.points.indexOf(pointOf(s, r, "quality.reliability"));
                [risk.points[a], quality.points[b]] = [quality.points[b]!, risk.points[a]!];
            },
        ],
        [
            "a point that cites another claim",
            (s, r) => {
                r.claimed_facts.push({
                    ...structuredClone(r.claimed_facts[0]!),
                    claim_id: "claim_copy",
                });
                pointOf(s, r, "risk.compliance").source.claim_id = "claim_copy";
            },
        ],
        ["a theme with no ring", (s) => void s.series.pop()],
        ["a ring keyed by no theme", (s) => void (series(s, "risk").key = "security")],
        ["an inner ring short of a theme", (s) => void series(s, "themes").points.pop()],
        [
            "an inner ring with a theme twice",
            (s) => {
                const inner = series(s, "themes").points;
                inner[1] = { ...structuredClone(inner[0]), label: inner[1]!.label };
            },
        ],
        [
            "an inner ring that cites a share",
            (s, r) => {
                const point = series(s, "themes").points[0];
                point.source.field = "share";
                point.value = rows(r)[point.source.row_index!]!.fields.share!.number!;
            },
        ],
        [
            "a ring short of a subcategory",
            (s, r) => {
                const index = rowIndex(r, "risk.vulnerability");
                const ring = series(s, "risk");
                ring.points.splice(
                    ring.points.findIndex((point) => point.source.row_index === index),
                    1,
                );
            },
        ],
        [
            "a ring that cites theme shares",
            (s, r) => {
                const point = pointOf(s, r, "risk.compliance");
                point.source.field = "theme_share";
                point.value = cell(r, "risk.compliance").theme_share!.number!;
            },
        ],
        [
            "a subcategory under another theme's ring",
            (s, r) => {
                // risk.compliance and quality.reliability (both share 0) swap rings: counts, sums,
                // words and rows stay right, and each sits under another theme's ring.
                const risk = series(s, "risk");
                const quality = series(s, "quality");
                const a = risk.points.indexOf(pointOf(s, r, "risk.compliance"));
                const b = quality.points.indexOf(pointOf(s, r, "quality.reliability"));
                [risk.points[a], quality.points[b]] = [quality.points[b]!, risk.points[a]!];
            },
        ],
        [
            "a subcategory twice",
            (s, r) => {
                // With no served words, only the plotted-once clause can refuse it.
                delete r.vocabulary_labels;
                const point = pointOf(s, r, "risk.compliance");
                point.source.row_index = rowIndex(r, "risk.vulnerability");
                point.label = "Vulnerability again";
            },
        ],
        [
            "a point that cites a table row, not a fact row",
            (s, r) => {
                pointOf(s, r, "risk.compliance").source.kind = "claimed_fact_table_row";
            },
        ],
        [
            "a label that is not its subcategory's served word",
            (s, r) => void (pointOf(s, r, "risk.compliance").label = "Compliance work"),
        ],
        ["a sum off its theme share", (s, r) => setShare(s, r, "risk.security", 0.06)],
        [
            "one subcategory above 0: no real split",
            (s, r) => {
                for (const row of rows(r)) {
                    const sub = row.fields.subcategory!.string!;
                    const theme = sub.split(".")[0]!;
                    const share = sub === "feature_delivery.customer" ? 0.25 : 0;
                    row.fields.share = { number: share };
                    row.fields.theme_share = { number: theme === "feature_delivery" ? 0.25 : 0 };
                }
                for (const ring of s.series) {
                    for (const point of ring.points) {
                        point.value =
                            rows(r)[point.source.row_index!]!.fields[point.source.field!]!.number!;
                    }
                }
            },
        ],
    ])("refuses %s", (_, edit) => {
        const { shape, result } = changed(edit);
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it.each<[string, Edit]>([
        [
            "a ring with another theme's word",
            (s) => void (series(s, "risk").label = "Quality / Reliability"),
        ],
        [
            "an inner ring label that is not its theme's word",
            (s) => {
                const inner = series(s, "themes").points;
                inner[0].label = "Not the theme's word";
            },
        ],
    ])("with the theme words served, refuses %s", (_, edit) => {
        const { shape, result } = changed((s, r) => {
            withThemeWords(s, r);
            edit(s, r);
        });
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it.each<[string, Edit]>([
        [
            "a row with no fields",
            (_, r) =>
                void delete (rows(r)[rowIndex(r, "risk.vulnerability")] as { fields?: unknown })
                    .fields,
        ],
        [
            "a point with no row index",
            (s, r) => void delete pointOf(s, r, "risk.compliance").source.row_index,
        ],
    ])("refuses malformed input without throwing: %s", (_, edit) => {
        const { shape, result } = changed(edit);
        expect(() => verifyRenderShape(shape, result)).not.toThrow();
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("trusts a theme word the answer serves none for", () => {
        const { shape, result } = changed(
            (s) => void (series(s, "risk").label = "Quality / Reliability"),
        );
        expect(result.vocabulary_labels?.["investment_theme:risk"]).toBeUndefined();
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});

function pair(value: { shape: RenderShape; result: InvestigationResult }) {
    return [value.shape, value.result] as const;
}
