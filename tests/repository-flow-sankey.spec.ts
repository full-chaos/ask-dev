import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, test } from "./support/signed-in";

// A verified team repository flow (CHAOS-12579). Standalone ask-dev has no host chart, so the
// reader gets the value table and the one line that says the chart is not shown here.
const FIXTURE = "src/test/fixtures/served-shapes/repository-flow-sankey.json";

async function openFlow(page: Page, width: number) {
    const result: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, result);
    await page.goto("/");
    await page
        .getByLabel("Ask a question")
        .fill("Where is the Platform team's effort going, by repository?");
    await page.getByRole("button", { name: "Send" }).click();
    const line = page.getByTestId("rich-shape-not-shown");
    await expect(line).toBeVisible();
    return line;
}

test.describe("Team repository flow, standalone", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`shows the value table and says the chart is not shown (${name})`, async ({
            page,
        }, testInfo) => {
            const line = await openFlow(page, width);
            await expect(line).toHaveText("The chart is not shown here.");
            await expect(page.getByTestId("rich-shape-withheld")).toHaveCount(0);
            // The served words of the flows' repositories are in the value table.
            for (const word of ["acme/web", "acme/api", "acme/infra"]) {
                await expect(page.getByRole("cell", { name: word }).first()).toBeVisible();
            }
            // The fact's own panel: the page scrolls inside its shell, so a page shot misses it.
            const panel = line.locator("xpath=ancestor::section[contains(@class, 'panel')][1]");
            await panel.screenshot({ path: testInfo.outputPath(`repository-flow-${name}.png`) });
        });
    }
});
