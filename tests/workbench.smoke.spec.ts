import { expect, test } from "./support/signed-in";

/**
 * Smoke coverage for the built artifact.
 *
 * These tests run as a user the fake ACR refuses. The Workbench has no mock
 * path, so the only honest thing it can do when ACR will not run an
 * investigation is say so — and proving THAT is the point: a failure must
 * present as a failure, never as a thin answer. Each spec is signed in first
 * (`./support/signed-in`).
 */
test.describe("Context Fabric Workbench smoke", () => {
    test("renders the shell and its platform/test framing", async ({ page }) => {
        await page.goto("/workbench");

        await expect(page.getByRole("heading", { name: "Context Fabric Workbench" })).toBeVisible();
        await expect(page.getByText(/separate from the Ask Dev window and \/dev/)).toBeVisible();
        await expect(page.getByLabel("Ask Context Fabric")).toBeVisible();
        await expect(page.getByText("Ask a question to run an investigation.")).toBeVisible();
    });

    test("reports a refusal by ACR as a failure, not an answer", async ({ page }) => {
        await page.goto("/workbench");

        await page.getByLabel("Ask Context Fabric").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Investigate" }).click();

        // Named explicitly: Next renders its own route announcer with
        // role="alert", so a bare getByRole("alert") is ambiguous.
        const failure = page.getByRole("alert", { name: "No answer" });
        await expect(failure).toBeVisible();
        await expect(failure).toHaveAttribute("data-failure-code", "acr_access_denied");

        // The crucial negative: no answer surface appears.
        await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(0);
        await expect(page.getByRole("article", { name: "Canonical result inspector" })).toHaveCount(
            0,
        );
    });
});
