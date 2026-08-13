import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the built artifact.
 *
 * These tests deliberately run with NO ACR configuration. The Workbench has no
 * mock path, so the only honest thing it can do without a configured server hop
 * is say so — and proving THAT is the point: a failure must present as a
 * failure, never as a thin answer.
 */
test.describe("Context Fabric Workbench smoke", () => {
    test("renders the shell and its platform/test framing", async ({ page }) => {
        await page.goto("/");

        await expect(page.getByRole("heading", { name: "Context Fabric Workbench" })).toBeVisible();
        await expect(page.getByText(/separate from the Ask Dev window and \/dev/)).toBeVisible();
        await expect(page.getByLabel("Ask Context Fabric")).toBeVisible();
        await expect(page.getByText("Ask a question to run an investigation.")).toBeVisible();
    });

    test("reports an unconfigured server hop as a failure, not an answer", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask Context Fabric").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Investigate" }).click();

        // Named explicitly: Next renders its own route announcer with
        // role="alert", so a bare getByRole("alert") is ambiguous.
        const failure = page.getByRole("alert", { name: "No answer" });
        await expect(failure).toBeVisible();
        await expect(failure.getByText(/workbench_misconfigured/)).toBeVisible();

        // The crucial negative: no answer surface appears.
        await expect(page.getByRole("article", { name: "Deterministic answer" })).toHaveCount(0);
        await expect(page.getByRole("article", { name: "Canonical result inspector" })).toHaveCount(
            0,
        );
    });
});
