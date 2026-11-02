import { expect, test, type Page } from "@playwright/test";

import { configuredBaseURL } from "../playwright.config";

/**
 * CHAOS-12106: the sign-in itself. With no token, the first ask sends the tab to ACR and back; the
 * address never keeps the one-time code; and the page the user asked from is where they land. The
 * question that started it is not sent, so the user asks again. These specs use no signed-in
 * fixture: the redirect is the point. They run on the configured instance, whose user ACR answers.
 */
test.use({ baseURL: configuredBaseURL });

// The shared client's keys (`ACR_TOKEN_FAMILY_KEY`, and the host's return key), duplicated: a spec
// cannot import `src/`.
const FAMILY_KEY = "ask-dev:acr-family";
const RETURN_KEY = "ask-dev:acr-return";

async function backOn(page: Page, pathname: string): Promise<boolean> {
    try {
        return await page.evaluate(
            ([family, expected]) =>
                window.sessionStorage.getItem(family as string) !== null &&
                window.location.pathname === expected,
            [FAMILY_KEY, pathname],
        );
    } catch {
        // Between documents: the redirect is still on its way.
        return false;
    }
}

test.describe("sign-in", () => {
    test("an ask with no token goes through the redirect and returns to the chat", async ({
        page,
    }) => {
        await page.goto("/");
        const box = page.getByLabel("Ask a question");
        await box.fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        await expect.poll(() => backOn(page, "/"), { timeout: 30_000 }).toBe(true);
        // The one-time code left the address, and the return path was used up.
        expect(page.url()).not.toContain("code=");
        expect(page.url()).not.toContain("oauth/callback");
        expect(await page.evaluate((key) => window.sessionStorage.getItem(key), RETURN_KEY)).toBe(
            null,
        );
        // No answer yet: the first question was not sent.
        await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(0);

        // Asking again needs no redirect, and answers.
        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();
        await expect(page.getByRole("article", { name: "Answer" })).toBeVisible();
    });

    test("the Workbench returns to the Workbench", async ({ page }) => {
        await page.goto("/workbench");
        await page.getByLabel("Ask Context Fabric").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Investigate" }).click();

        await expect.poll(() => backOn(page, "/workbench"), { timeout: 30_000 }).toBe(true);
        await page.getByLabel("Ask Context Fabric").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Investigate" }).click();
        await expect(page.getByRole("article", { name: "Answer" })).toBeVisible();
    });

    test("a callback with no pending sign-in shows one line and a way back", async ({ page }) => {
        await page.goto("/oauth/callback?code=stale&state=stale&iss=nowhere");
        await expect(page.getByText("Ask Dev could not sign you in.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Back to Ask Dev" })).toBeVisible();
        expect(page.url()).not.toContain("code=");
    });
});
