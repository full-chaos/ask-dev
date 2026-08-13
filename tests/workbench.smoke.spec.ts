import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the built artifact: the shell loads, a question can be
 * asked, and the sections that must never be hidden are present.
 */
test.describe("Ask Dev Workbench smoke", () => {
    test("renders the canonical investigation result", async ({ page }) => {
        await page.goto("/");

        await expect(page.getByRole("heading", { name: "Ask Dev Workbench" })).toBeVisible();
        const result = page.getByRole("article", { name: "Investigation result" });
        await expect(result).toBeVisible();
        await expect(result.getByText(/Ask Dev is not release-ready\./).first()).toBeVisible();
        await expect(page.getByRole("region", { name: "Coverage" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Limitations" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Evidence references" })).toBeVisible();
    });

    test("asking a different question re-renders the result", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("Is Atlas on track?");
        await page.getByRole("button", { name: "Investigate" }).click();

        const subjects = page.getByRole("region", { name: "Subjects" });
        await expect(subjects.getByText("Nothing committed.")).toBeVisible();
        await expect(page.getByText("The service returned no direct judgment.")).toBeVisible();
    });

    test("degraded coverage states are visible, not hidden", async ({ page }) => {
        await page.goto("/");

        await page
            .getByRole("button", {
                name: "Which projects are slipping, and how confident can we be in that?",
            })
            .click();

        const coverage = page.getByRole("region", { name: "Coverage" });
        await expect(
            coverage.getByText("Partial — some sources did not contribute."),
        ).toBeVisible();
        await expect(coverage.getByTitle("pruned")).toBeVisible();
        await expect(coverage.getByTitle("unauthorized")).toBeVisible();
    });
});
