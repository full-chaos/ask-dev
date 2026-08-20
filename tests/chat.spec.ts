import { expect, test } from "@playwright/test";

import { configuredBaseURL } from "../playwright.config";

// Kept in sync by hand with tests/support/fake-acr-server.mjs's own
// `TRIGGER_CLARIFICATION` — NOT imported from it. Playwright's test
// transform cannot load that file's ESM `import.meta` outside a module
// context (it runs .mjs support files as plain Node, not through the same
// transform as .spec.ts), so importing across that boundary throws at
// collection time. A one-line literal duplicated in two places, checked by
// the e2e run itself the moment either one drifts, beats fighting the loader
// for a constant this small.
const TRIGGER_CLARIFICATION = "e2e-clarify-me";

/**
 * Smoke coverage for the chat surface's shell and its honest-failure path.
 *
 * Runs against the SAME unconfigured app instance as
 * `tests/workbench.smoke.spec.ts` (this file's default `baseURL`) — there is
 * no mock path here either, so an unconfigured server hop must present as a
 * failure, never a thin answer, exactly as it does on `/workbench`.
 */
test.describe("Ask Dev chat shell", () => {
    test("renders the timeline shell and its empty state", async ({ page }) => {
        await page.goto("/");

        await expect(page.getByRole("heading", { name: "Ask Dev" })).toBeVisible();
        await expect(page.getByLabel("Ask a question")).toBeVisible();
        await expect(page.getByText("Ask a question to start an investigation.")).toBeVisible();
    });

    test("reports an unconfigured server hop as a failure, not an answer", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        const failure = page.getByRole("alert", { name: "No answer" });
        await expect(failure).toBeVisible();
        await expect(failure.getByText(/workbench_misconfigured/)).toBeVisible();
        await expect(page.getByRole("article", { name: "Deterministic answer" })).toHaveCount(0);
    });

    test("links to the Context Fabric Workbench", async ({ page }) => {
        await page.goto("/");

        await page.getByRole("link", { name: "Context Fabric Workbench →" }).click();
        await expect(page).toHaveURL(/\/workbench$/);
        await expect(page.getByRole("heading", { name: "Context Fabric Workbench" })).toBeVisible();
    });
});

/**
 * Clarification-chip POSITIVE and NEGATIVE controls.
 *
 * Runs against the SECOND app instance (`configuredBaseURL`), configured to
 * talk to `tests/support/fake-acr-server.mjs` — a real HTTP server on the
 * real network, not an in-test mock (see that file's header for why this is
 * the only honest way to prove a real, schema-valid `clarification_required`
 * response renders chips, given the pinned contract's `additionalProperties:
 * false`). Every request here is genuine: browser → Next.js → signed fetch →
 * the fake-ACR process → a real HTTP response → the app's own contract
 * validator → the DOM.
 */
test.describe("clarification chips", () => {
    test.use({ baseURL: configuredBaseURL });

    test("POSITIVE: a question ACR cannot commit renders subject-choice chips", async ({
        page,
    }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill(`Who owns this, ${TRIGGER_CLARIFICATION}?`);
        await page.getByRole("button", { name: "Send" }).click();

        await expect(
            page.getByRole("region", { name: "Which subject did you mean?" }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask again about Ask Dev" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask again about Atlas" })).toBeVisible();

        // Picking a chip re-asks and shows the answer for the CHOSEN subject —
        // proving the chip is wired, not decorative.
        await page.getByRole("button", { name: "Ask again about Ask Dev" }).click();
        await expect(page.getByRole("article", { name: "Deterministic answer" })).toBeVisible();
        // The superseded clarification turn is still on screen, but frozen:
        // its own candidate list no longer offers a choice.
        await expect(page.getByTestId("cannot-choose-here")).toBeVisible();
    });

    test("NEGATIVE: a decisive answer renders no clarification chips", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        await expect(page.getByRole("article", { name: "Deterministic answer" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Which subject did you mean?" })).toHaveCount(
            0,
        );
        await expect(page.getByRole("button", { name: /^Ask again about /u })).toHaveCount(0);
        await expect(page.getByTestId("cannot-choose-here")).toHaveCount(0);
    });
});
