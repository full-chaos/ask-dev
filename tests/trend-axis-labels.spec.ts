import type { Locator, Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

/**
 * CHAOS-12854: a trend line's first and last x-axis labels sat centred on the plot's edge points,
 * so about half of each fell outside the SVG and was cut off ("26-08-28", "2026-08"). jsdom has no
 * text layout, so this measures the drawn labels in a real browser: every axis label's box lies
 * inside its chart's viewBox.
 */
const TREND = "src/test/fixtures/served-shapes/cadence-missing-day.json";
const BARS = "src/test/fixtures/served-shapes/category-order.json";

async function answer(page: Page, fixture: string, width: number) {
    const result: unknown = JSON.parse(readFileSync(fixture, "utf8"));
    await page.setViewportSize({ width, height: 900 });
    await answerInvestigations(page, result);
    await gotoStyled(page, "/");
    await page.getByLabel("Ask a question").fill("How has this changed over time?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("article", { name: "Answer" })).toHaveAttribute(
        "data-state",
        "complete",
    );
}

/** Each axis label of the figure's chart, with its box in the SVG's own units. */
async function axisLabelBoxes(figure: Locator) {
    return figure
        .locator("svg[role='img']")
        .first()
        .evaluate((svg) => {
            const view = (svg as SVGSVGElement).viewBox.baseVal;
            return Array.from(svg.querySelectorAll<SVGTextElement>("text.fact-chart__axis-label"))
                .filter(
                    (text) =>
                        text.getAttribute("text-anchor") !== "start" ||
                        text.getAttribute("x") !== "0",
                )
                .map((text) => {
                    const box = text.getBBox();
                    return {
                        // The drawn words only: the `<title>` child holds the full label too.
                        text: Array.from(text.childNodes)
                            .filter((node) => node.nodeType === Node.TEXT_NODE)
                            .map((node) => node.textContent ?? "")
                            .join(""),
                        left: Math.round(box.x * 10) / 10,
                        right: Math.round((box.x + box.width) * 10) / 10,
                        viewLeft: view.x,
                        viewRight: view.x + view.width,
                    };
                });
        });
}

function outside(boxes: Awaited<ReturnType<typeof axisLabelBoxes>>) {
    return boxes
        .filter((box) => box.left < box.viewLeft || box.right > box.viewRight)
        .map(
            (box) =>
                `${box.text}: ${box.left}..${box.right} outside ${box.viewLeft}..${box.viewRight}`,
        );
}

test.describe("axis labels are drawn whole (CHAOS-12854)", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`a trend line's first and last labels stay inside the chart (${name})`, async ({
            page,
        }, testInfo) => {
            await answer(page, TREND, width);
            const figure = page
                .locator("figure.render-shape", { has: page.locator("svg[role='img'] polyline") })
                .first();
            await expect(figure).toBeVisible();
            const boxes = await axisLabelBoxes(figure);
            // Discriminating: the edge labels are really drawn, full dates, not an empty axis.
            expect(boxes.length).toBeGreaterThanOrEqual(2);
            expect(boxes.every((box) => /^\d{4}-\d{2}-\d{2}$/u.test(box.text.trim()))).toBe(true);
            await figure.screenshot({ path: testInfo.outputPath(`trend-axis-${name}.png`) });
            expect(outside(boxes)).toEqual([]);
        });

        test(`category bars keep every label inside the chart (${name})`, async ({ page }) => {
            await answer(page, BARS, width);
            const figure = page
                .locator("figure.render-shape", {
                    has: page.locator("svg[role='img'] g.fact-chart__mark-group path"),
                })
                .first();
            await expect(figure).toBeVisible();
            const boxes = await axisLabelBoxes(figure);
            expect(boxes.length).toBeGreaterThanOrEqual(2);
            expect(outside(boxes)).toEqual([]);
        });
    }
});
