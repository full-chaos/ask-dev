import type { Page } from "@playwright/test";

import { readFileSync } from "node:fs";

import { answerInvestigations, expect, gotoStyled, test } from "./support/signed-in";

/**
 * CHAOS-12559: ACR's bounded answer, from ACR's real projector at the pin
 * (`src/test/fixtures/bounded-answers`), drawn as the shortened answer in the chat and in the
 * Workbench, at phone and desktop width. The partial-table fixture keeps 128 rows across two
 * facts and no chart, so its rows are drawn by the row panels.
 */
const FIXTURES = {
    answer: "src/test/fixtures/bounded-answers/bounded-answer.json",
    rows: "src/test/fixtures/bounded-answers/bounded-partial-table.json",
} as const;

const SURFACES = {
    chat: { path: "/", box: "Ask a question", send: "Send" },
    workbench: { path: "/workbench", box: "Ask Context Fabric", send: "Investigate" },
} as const;

async function openBounded(
    page: Page,
    surface: keyof typeof SURFACES,
    fixture: keyof typeof FIXTURES,
    width: number,
) {
    const projection: unknown = JSON.parse(readFileSync(FIXTURES[fixture], "utf8"));
    const { path, box, send } = SURFACES[surface];
    await page.setViewportSize({ width, height: 844 });
    await answerInvestigations(page, projection);
    // The sideways check below needs the stylesheet applied (CHAOS-12636).
    await gotoStyled(page, path);
    await page.getByLabel(box).fill("Which teams are struggling right now, and why?");
    await page.getByRole("button", { name: send }).click();
    const view = page.getByRole("region", { name: "Shortened answer" });
    await expect(view).toBeVisible();
    return view;
}

test.describe("A bounded answer", () => {
    for (const surface of ["chat", "workbench"] as const) {
        for (const fixture of ["answer", "rows"] as const) {
            for (const [name, width] of [
                ["desktop", 1280],
                ["phone", 390],
            ] as const) {
                test(`is drawn in the ${surface} with what it left out (${fixture}) at ${name} width`, async ({
                    page,
                }, testInfo) => {
                    const view = await openBounded(page, surface, fixture, width);
                    await expect(view.getByRole("note")).toContainText(
                        "This answer was shortened to fit",
                    );
                    if (fixture === "answer") {
                        await expect(view.getByRole("group", { name: "Drivers" })).toBeVisible();
                    } else {
                        // A date from the kept rows, drawn by the row panel.
                        await expect(view.getByText(/2026-08-25/).first()).toBeVisible();
                    }
                    await expect(page.getByText(/too large to show here/)).toHaveCount(0);
                    const sideways = await page.evaluate(
                        () => document.documentElement.scrollWidth - window.innerWidth,
                    );
                    expect(sideways).toBe(0);
                    // The answer is taller than a screen: the capture uses a viewport tall enough
                    // for the whole answer, so the screenshot shows it from its first line.
                    await page.setViewportSize({ width, height: 2400 });
                    await view.evaluate((node) => node.scrollIntoView({ block: "start" }));
                    await page.screenshot({
                        path: testInfo.outputPath(`bounded-${surface}-${fixture}-${name}.png`),
                    });
                });
            }
        }
    }
});
