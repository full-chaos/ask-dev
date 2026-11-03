import { describe, expect, it } from "vitest";

import type { InvestigationResult, RenderShape } from "@/lib/contracts";
import {
    COMPARISON_RULE,
    FORECAST_PERCENTILES_RULE,
    LANDSCAPE_POSITION_RULE,
    REPOSITORY_FLOW_RULE,
    THEME_SHARE_RULE,
    renderShapesFor,
    verifyRenderShape,
} from "@/lib/render-shapes";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

/**
 * CHAOS-12697: a rich shape's words are held to the answer's OWN served vocabulary labels. Where the
 * answer serves `vocabulary_labels["<vocabulary>:<token>"]` for a label's token, the label must be
 * that word, or the shape is withheld. Where it serves none (labels flag off, an old pin, or a token
 * the answer does not use), the word stays trusted to acr's validator. ask-dev holds no word table
 * (CHAOS-4690): every expected word below is read from the fixture's own map.
 */

type Scenario = keyof typeof servedShapeScenarios;

function served(name: Scenario): { shape: RenderShape; result: InvestigationResult } {
    const result = structuredClone(servedShapeScenarios[name]);
    return { shape: result.render_shapes![0]!, result };
}

const WRONG = "Not the served word";

describe("the repro: a forecast table point with right numbers and a wrong word", () => {
    it("withholds the percentiles table when the P50 label is not the served P50 word", () => {
        const { shape, result } = served("forecast-not-stored");
        expect(shape.selected_by).toBe(FORECAST_PERCENTILES_RULE);
        const p50 = shape.series[0].points.find(
            (point) => point.source.field === "forecast_p50_days",
        )!;
        expect(p50.value).toBe(40);
        expect(verifyRenderShape(shape, result), "the control: as served").toBe(true);
        p50.label = "Not the served P50 word";
        expect(verifyRenderShape(shape, result)).toBe(false);
        const verdict = renderShapesFor(result, [FORECAST_PERCENTILES_RULE]);
        expect(verdict.shapes).toEqual([]);
        expect(verdict.withheld).toBe(1);
    });

    it("keeps trusting a percentile word the answer serves none for (P85)", () => {
        const { shape, result } = served("forecast-not-stored");
        expect(result.vocabulary_labels?.["fact_field:forecast_p85_days"]).toBeUndefined();
        const p85 = shape.series[0].points.find(
            (point) => point.source.field === "forecast_p85_days",
        )!;
        p85.label = WRONG;
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});

describe("the treemap: a point's word is its row's served theme word", () => {
    it("admits the served treemap and withholds a point with another word", () => {
        const { shape, result } = served("investment-treemap");
        expect(shape.selected_by).toBe(THEME_SHARE_RULE);
        expect(verifyRenderShape(shape, result), "the control: as served").toBe(true);
        shape.series[0].points[0].label = WRONG;
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("withholds two themes' words swapped, though each is a served theme word", () => {
        const { shape, result } = served("investment-treemap");
        const [first, second] = shape.series[0].points;
        [first.label, second!.label] = [second!.label, first.label];
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("trusts the word when the answer serves no theme words", () => {
        const { shape, result } = served("investment-treemap");
        delete result.vocabulary_labels;
        shape.series[0].points[0].label = WRONG;
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});

describe("the sankey: a series' word is its theme's served word", () => {
    it("admits the served sankey and withholds a series with another word", () => {
        const { shape, result } = served("repository-flow-sankey");
        expect(shape.selected_by).toBe(REPOSITORY_FLOW_RULE);
        expect(verifyRenderShape(shape, result), "the control: as served").toBe(true);
        shape.series[0].label = WRONG;
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("trusts the word when the answer serves no theme words", () => {
        const { shape, result } = served("repository-flow-sankey");
        delete result.vocabulary_labels;
        shape.series[0].label = WRONG;
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});

describe("the comparison table: a point's word is its field's served word", () => {
    it("admits the served table and withholds a measure with another word on every side", () => {
        const { shape, result } = served("comparison-table-served");
        expect(shape.selected_by).toBe(COMPARISON_RULE);
        expect(verifyRenderShape(shape, result), "the control: as served").toBe(true);
        // The same wrong word on every side, so only the word check can refuse it.
        const field = shape.series[0].points[0].source.field;
        for (const series of shape.series) {
            for (const point of series.points) {
                if (point.source.field === field) point.label = WRONG;
            }
        }
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("trusts the word when the answer serves no field words", () => {
        const { shape, result } = served("comparison-table-served");
        delete result.vocabulary_labels;
        const field = shape.series[0].points[0].source.field;
        for (const series of shape.series) {
            for (const point of series.points) {
                if (point.source.field === field) point.label = WRONG;
            }
        }
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});

describe("the quadrant: each series' and axis's word is its field's served word", () => {
    // The served quadrant was encoded with the labels flag off, so it carries no map. A map that
    // serves each field the word the shape already carries stands for the flag on.
    function withFieldWords(xWord: string, yWord: string) {
        const { shape, result } = served("landscape-quadrant");
        expect(shape.selected_by).toBe(LANDSCAPE_POSITION_RULE);
        expect(result.vocabulary_labels).toBeUndefined();
        const [x, y] = shape.series;
        result.vocabulary_labels = {
            [`fact_field:${x.key}`]: xWord,
            [`fact_field:${y!.key}`]: yWord,
        };
        return { shape, result, x: x, y: y! };
    }

    it("admits the quadrant whose words are the served ones", () => {
        const { shape, result, x, y } = withFieldWords("", "");
        result.vocabulary_labels = {
            [`fact_field:${x.key}`]: x.label,
            [`fact_field:${y.key}`]: y.label,
        };
        expect(verifyRenderShape(shape, result)).toBe(true);
    });

    it("withholds an x axis whose word is not its field's served word", () => {
        const { shape, result, y } = withFieldWords("Another x word", "");
        result.vocabulary_labels!["fact_field:" + y.key] = y.label;
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("withholds a y axis whose word is not its field's served word", () => {
        const { shape, result, x } = withFieldWords("", "Another y word");
        result.vocabulary_labels!["fact_field:" + x.key] = x.label;
        expect(verifyRenderShape(shape, result)).toBe(false);
    });

    it("trusts the words when the answer serves none, as the served quadrant does", () => {
        const { shape, result } = served("landscape-quadrant");
        expect(verifyRenderShape(shape, result)).toBe(true);
    });
});
