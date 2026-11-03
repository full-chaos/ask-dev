import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

// A verified completion forecast (CHAOS-12695): the curve, and the percentiles table acr serves when
// no curve is drawn. Standalone ask-dev has no host chart, so the curve shows its value table and the
// one line that says the chart is not shown here; the table is its own view.
const FIXTURES = "src/test/fixtures/served-shapes";

async function ask(page: Page, fixture: string, width: number) {
    const result: unknown = JSON.parse(readFileSync(`${FIXTURES}/${fixture}.json`, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, result);
    // CHAOS-12636: measured on a styled page, never on one whose stylesheet request failed.
    await gotoStyled(page, "/");
    await page.getByLabel("Ask a question").fill("When will CHAOS finish its backlog?");
    await page.getByRole("button", { name: "Send" }).click();
}

async function noSidewaysScroll(page: Page) {
    const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways).toBe(0);
}

test.describe("Completion forecast, standalone", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`the curve shows its value table and says the chart is not shown (${name})`, async ({
            page,
        }, testInfo) => {
            await ask(page, "forecast-curve", width);
            const figure = page.locator("figure", { hasText: "Completion forecast" });
            await expect(figure.getByTestId("rich-shape-not-shown")).toHaveText(
                "The chart is not shown here.",
            );
            await expect(page.getByTestId("forecast-shape-withheld")).toHaveCount(0);
            // The horizon bin is the last row: the runs that had not finished by the horizon.
            await expect(figure.getByRole("rowheader", { name: "365", exact: true })).toBeVisible();
            await noSidewaysScroll(page);
            const panel = figure.locator("xpath=ancestor::section[contains(@class, 'panel')][1]");
            await panel.screenshot({ path: testInfo.outputPath(`forecast-curve-${name}.png`) });
        });

        test(`the percentiles table says why no curve is drawn (${name})`, async ({
            page,
        }, testInfo) => {
            await ask(page, "forecast-not-stored", width);
            const table = page.getByTestId("forecast-percentiles");
            await expect(table).toBeVisible();
            await expect(table.getByTestId("forecast-percentiles-states")).toBeVisible();
            await expect(page.getByTestId("forecast-percentiles-withheld")).toHaveCount(0);
            await noSidewaysScroll(page);
            await table.screenshot({
                path: testInfo.outputPath(`forecast-percentiles-${name}.png`),
            });
        });
    }
});
