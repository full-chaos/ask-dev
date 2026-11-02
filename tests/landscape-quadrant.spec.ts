import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

// A verified landscape quadrant (CHAOS-12624). Standalone ask-dev has no host chart, so the reader
// gets the value table and the one line that says the chart is not shown here.
const FIXTURE = "src/test/fixtures/served-shapes/landscape-quadrant.json";

async function openQuadrant(page: Page, width: number) {
    const result: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, result);
    // CHAOS-12636: the layout below is measured on a styled page, never on one whose stylesheet
    // request failed.
    await gotoStyled(page, "/");
    await page
        .getByLabel("Ask a question")
        .fill("Where do these teams stand on churn and delivery?");
    await page.getByRole("button", { name: "Send" }).click();
    const panel = page.getByTestId("landscape-quadrant");
    await expect(panel).toBeVisible();
    return panel;
}

test.describe("Landscape quadrant, standalone", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`shows the value table and says the chart is not shown (${name})`, async ({
            page,
        }, testInfo) => {
            const panel = await openQuadrant(page, width);
            await expect(panel.getByTestId("rich-shape-not-shown")).toHaveText(
                "The chart is not shown here.",
            );
            await expect(page.getByTestId("landscape-quadrant-withheld")).toHaveCount(0);
            await expect(panel.locator("figcaption")).toHaveText(
                "Churn and delivery units, 30 days to Nov 2, 2026",
            );
            // The teams' served words are in the value table; the one-identity team is not.
            for (const word of ["Identity", "Delivery", "Payments", "Checkout"]) {
                await expect(
                    panel.getByRole("rowheader", { name: word, exact: true }),
                ).toBeVisible();
            }
            await expect(panel.getByRole("rowheader", { name: "Mobile", exact: true })).toHaveCount(
                0,
            );
            // The page does not scroll sideways: the value table stays in its own scroll region.
            const sideways = await page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expect(sideways).toBe(0);
            await panel.screenshot({ path: testInfo.outputPath(`landscape-quadrant-${name}.png`) });
        });
    }
});
