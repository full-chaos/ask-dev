import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, test } from "./support/signed-in";

/**
 * CHAOS-12559: ACR's bounded answer, from ACR's real projector at the pin
 * (`src/test/fixtures/bounded-answers`), drawn as the shortened answer at phone and desktop width.
 */
const FIXTURE = "src/test/fixtures/bounded-answers/bounded-answer.json";

async function openBounded(page: Page, width: number) {
    const projection: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, projection);
    await page.goto("/");
    await page.getByLabel("Ask a question").fill("Which teams are struggling right now, and why?");
    await page.getByRole("button", { name: "Send" }).click();
    const view = page.getByRole("region", { name: "Shortened answer" });
    await expect(view).toBeVisible();
    return view;
}

test.describe("A bounded answer", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`is drawn with what it left out at ${name} width`, async ({ page }, testInfo) => {
            const view = await openBounded(page, width);
            await expect(view.getByRole("note")).toContainText("This answer was shortened to fit");
            await expect(view.getByRole("group", { name: "Drivers" })).toBeVisible();
            await expect(page.getByText(/too large to show here/)).toHaveCount(0);
            const sideways = await page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expect(sideways).toBe(0);
            await page.screenshot({
                path: testInfo.outputPath(`bounded-answer-${name}.png`),
                fullPage: true,
            });
        });
    }
});
