import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

// CHAOS-12725: an answer that carries a window offer (acr answered on an inferred window,
// CHAOS-4451) used to open the floating "Over what period?" popup over the answer, covering its
// chart. The popup now opens on its own only for a clarification; the answer's offer sits under it.
const FIXTURE = "src/test/fixtures/served-shapes/forecast-curve-window-offer.json";

test.describe("An answer with a window offer", () => {
    for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 390],
    ] as const) {
        test(`draws its chart unobscured and offers the window under it (${name})`, async ({
            page,
        }, testInfo) => {
            const result: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
            await page.setViewportSize({ width, height: 844 });
            await answerInvestigations(page, result);
            await gotoStyled(page, "/");
            await page.getByLabel("Ask a question").fill("When will CHAOS finish its backlog?");
            await page.getByRole("button", { name: "Send" }).click();

            const figure = page.locator("figure", { hasText: "Completion forecast" });
            await expect(figure).toBeVisible();
            const offers = page.getByRole("group", { name: "Answer offers" });
            await expect(offers).toBeVisible();
            await expect(offers.getByText("Last 30 days")).toBeVisible();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await page.screenshot({
                path: testInfo.outputPath(`answer-with-window-offer-${name}.png`),
            });

            // The offer is still reachable: Change period opens the picker on demand.
            await offers.getByRole("button", { name: "Change period" }).click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            await expect(dialog.getByText("Last 90 days")).toBeVisible();
            await page.screenshot({
                path: testInfo.outputPath(`window-picker-opened-${name}.png`),
            });
        });
    }
});
