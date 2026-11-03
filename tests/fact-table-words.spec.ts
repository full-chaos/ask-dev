import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

// A declared table's rows in served words (CHAOS-12635): the team's repository_theme_breakdown shows
// each repository by its handle and each theme by its word, and the ids and tokens stay in one
// collapsed "Exact values" fold under the table.
const FIXTURE = "src/test/fixtures/served-shapes/repository-flow-sankey.json";

async function openFlow(page: Page, width: number) {
    const result: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, result);
    await gotoStyled(page, "/");
    await page
        .getByLabel("Ask a question")
        .fill("Where is the Platform team's effort going, by repository?");
    await page.getByRole("button", { name: "Send" }).click();
    const facts = page.getByRole("group", { name: "Facts", exact: true }).first();
    await expect(facts).toBeVisible();
    return facts;
}

test.describe("A declared table in served words", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`shows handles and theme words, and folds the exact values (${name})`, async ({
            page,
        }, testInfo) => {
            const facts = await openFlow(page, width);
            await expect(facts.getByRole("cell", { name: "acme/web" }).first()).toBeVisible();
            await expect(
                facts.getByRole("cell", { name: "Feature Delivery" }).first(),
            ).toBeVisible();
            await expect(facts).not.toContainText("repository:");
            await expect(facts).not.toContainText("feature_delivery");
            const fold = page.getByTestId("fact-table-exact");
            await expect(fold).toHaveCount(1);
            await expect(fold).not.toHaveAttribute("open");
            const sideways = await page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expect(sideways).toBe(0);
            const panel = facts.locator("xpath=ancestor::section[contains(@class, 'panel')][1]");
            await panel.screenshot({ path: testInfo.outputPath(`fact-table-words-${name}.png`) });
            // Opened, the fold holds every id and token as served.
            await fold.locator("summary").click();
            await expect(fold.getByRole("table")).toContainText("repository:");
            await expect(fold.getByRole("table")).toContainText("feature_delivery");
            await panel.screenshot({
                path: testInfo.outputPath(`fact-table-words-${name}-exact.png`),
            });
        });
    }
});
