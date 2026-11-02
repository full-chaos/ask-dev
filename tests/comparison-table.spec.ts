import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { readFileSync } from "node:fs";

const FIXTURE = "src/test/fixtures/served-shapes/comparison-table.json";

async function openTable(page: Page, width: number) {
    const result: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/investigations", (route) =>
        route.fulfill({
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ result }),
        }),
    );
    await page.goto("/");
    await page.getByLabel("Ask a question").fill("Compare the two repositories");
    await page.getByRole("button", { name: "Send" }).click();
    const panel = page.getByTestId("comparison-table");
    await expect(panel).toBeVisible();
    return panel;
}

async function liesInside(inner: Locator, outer: Locator) {
    const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.x).toBeGreaterThanOrEqual(b!.x - 0.5);
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 0.5);
}

const region = (panel: Locator) => panel.locator(".fact-table-wrap").first();
const lastRowCell = (panel: Locator, column: number) =>
    panel.getByRole("row").nth(1).getByRole("cell").nth(column);

test.describe("Side-by-side comparison", () => {
    test("shows every side at desktop width, with nothing to scroll", async ({ page }) => {
        const panel = await openTable(page, 1280);
        await liesInside(lastRowCell(panel, 0), region(panel));
        await liesInside(lastRowCell(panel, 1), region(panel));
        const spare = await region(panel).evaluate((n) => n.clientWidth - n.scrollWidth);
        expect(spare).toBeGreaterThanOrEqual(0);
    });

    test("keeps the values in reach at phone width", async ({ page }) => {
        const panel = await openTable(page, 390);
        // The first side is in view with no scroll: a word wraps, a value does not.
        await liesInside(lastRowCell(panel, 0), region(panel));
        await expect(region(panel)).toHaveAttribute("tabindex", "0");
        await lastRowCell(panel, 1).scrollIntoViewIfNeeded();
        await liesInside(lastRowCell(panel, 1), region(panel));
        const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(sideways).toBe(0);
    });

    test("keeps the exact values in reach at phone width", async ({ page }) => {
        const panel = await openTable(page, 390);
        const fold = panel.getByTestId("comparison-table-exact");
        await fold.getByText("Exact values").click();
        const exact = fold.getByRole("row").nth(1).getByRole("cell").nth(0);
        await expect(exact).toHaveText("1.9530555555555558");
        await exact.scrollIntoViewIfNeeded();
        await liesInside(exact, fold.locator(".fact-table-wrap"));
    });
});
