import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { ShapeSlotContext, type ShapeSlot } from "@/components/ShapeSlotContext";
import { servedShapeScenarios } from "@/test/fixtures/served-shapes";

afterEach(cleanup);

/**
 * CHAOS-12840 (E8 AC-4): the chart a11y check. axe's own rules pass a chart with no value table,
 * because a drawing with a name is valid on its own; so the check adds one rule of ours: every
 * drawn view (`figure.render-shape`) carries its value table, the accessible form of the drawing.
 * The red control is a planted render without `ShapeDataTable`: this test must then fail.
 */
const CHART_RULE = "ask-dev-chart-value-table";

beforeAll(() => {
    axe.configure({
        checks: [
            {
                id: "ask-dev-figure-has-value-table",
                evaluate: (node: Element) => {
                    const title = node.querySelector("figcaption")?.textContent ?? "";
                    // The table of THIS drawing: its caption is the drawing's title, and it has rows.
                    return Array.from(node.querySelectorAll("table")).some(
                        (table) =>
                            table.querySelector("caption")?.textContent === title &&
                            table.querySelectorAll("tbody tr").length > 0,
                    );
                },
            },
        ],
        rules: [
            {
                id: CHART_RULE,
                selector: "figure.render-shape",
                any: ["ask-dev-figure-has-value-table"],
                tags: ["ask-dev-chart"],
            },
        ],
    });
});

afterAll(() => {
    axe.reset();
});

/** A host's chart: a drawing with a name, as web's canvas charts are. */
const hostChart: ShapeSlot = (shape) => <div aria-label={shape.title} role="img" />;

async function violations(container: HTMLElement) {
    const outcome = await axe.run(container, {
        runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "ask-dev-chart"],
        },
        // jsdom has no layout, so contrast cannot be measured here; the live suite runs it.
        rules: { "color-contrast": { enabled: false } },
    });
    return outcome.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target.join(" ")),
    }));
}

const scenarios = Object.entries(servedShapeScenarios);

describe("the chart a11y check (CHAOS-12840)", () => {
    it.each(scenarios)(
        "%s: every drawn view passes axe AA and carries its value table",
        async (_name, result) => {
            const { container } = render(
                <ShapeSlotContext.Provider value={hostChart}>
                    <DeterministicAnswerView result={result} />
                </ShapeSlotContext.Provider>,
            );
            expect(await violations(container)).toEqual([]);
        },
        30_000,
    );

    it("draws both kinds of view, so the check has charts to read", () => {
        // Discriminating: a pass above is not an answer that drew nothing. Both seams are here:
        // ask-dev's own SVG chart (RenderShapeChart) and a host's chart (RichShape).
        let svg = 0;
        let host = 0;
        for (const [, result] of scenarios) {
            const { container, unmount } = render(
                <ShapeSlotContext.Provider value={hostChart}>
                    <DeterministicAnswerView result={result} />
                </ShapeSlotContext.Provider>,
            );
            for (const figure of container.querySelectorAll("figure.render-shape")) {
                if (figure.querySelector("svg[role='img']")) svg += 1;
                else if (figure.querySelector("div[role='img']")) host += 1;
            }
            unmount();
        }
        expect(svg).toBeGreaterThan(0);
        expect(host).toBeGreaterThan(0);
    });
});
