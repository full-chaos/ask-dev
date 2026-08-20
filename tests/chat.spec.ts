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
// Kept in sync by hand with `TRIGGER_STRUCTURE_NEEDS` for the same reason.
const TRIGGER_STRUCTURE_NEEDS = "e2e-structure-me";

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

        // Every DeterministicAnswerView turn shares the SAME `aria-label`
        // ("Deterministic answer") whether the result is a clarification or
        // a decisive answer — so "an article is present" does not, by
        // itself, prove the chip actually resolved anything. `data-state`
        // mirrors the result's own `status` field and is the one signal
        // that can ONLY read "complete" when ACR actually committed a
        // subject (see DeterministicAnswerView.tsx's own comment on it).
        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(1);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");

        // Picking a chip re-asks with the CHOSEN receipt — proving the chip
        // is wired, not decorative.
        await page.getByRole("button", { name: "Ask again about Ask Dev" }).click();

        await expect(turns).toHaveCount(2);
        // The first turn is frozen at its original (clarification) state...
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");
        // ...and the SECOND turn is the discriminating proof: it can only
        // be "complete" if the fake-ACR double actually recognized the
        // chosen receipt and returned a decisive result, not another
        // clarification (the exact regression a wrong wire-field name
        // produced — see fake-acr-server.mjs's own comment on
        // `prior_subject_receipts`).
        await expect(turns.last()).toHaveAttribute("data-state", "complete");

        // No NEW clarification prompt reappeared — the live heading is gone.
        await expect(page.getByRole("region", { name: "Which subject did you mean?" })).toHaveCount(
            0,
        );
        // The superseded clarification turn is still on screen, but frozen:
        // its own candidate list no longer offers a choice.
        await expect(page.getByTestId("cannot-choose-here")).toBeVisible();
    });

    test("NEGATIVE: a decisive answer renders no clarification chips", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        const turn = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turn).toHaveCount(1);
        // Discriminating, not just "no chip buttons happen to be on screen":
        // the turn's own state is decisive, not a clarification the UI
        // merely failed to render chips for.
        await expect(turn).toHaveAttribute("data-state", "complete");
        await expect(turn).not.toHaveAttribute("data-state", "clarification_required");

        await expect(page.getByRole("region", { name: "Which subject did you mean?" })).toHaveCount(
            0,
        );
        await expect(page.getByRole("button", { name: /^Ask again about /u })).toHaveCount(0);
        await expect(page.getByTestId("cannot-choose-here")).toHaveCount(0);

        // NEGATIVE control for the structure-needs panel too (CHAOS-3927
        // P1/P2, "structure needs chips" describe block below): a decisive
        // answer carries no `structure_needs`, so the panel must not render
        // either.
        await expect(
            page.getByRole("region", { name: "More structure would narrow this" }),
        ).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Select /u })).toHaveCount(0);
    });
});

/**
 * Structure-needs-chip POSITIVE control (CHAOS-3927 P1/P2). Same discipline
 * and same fake-ACR double as "clarification chips" above — see
 * `tests/support/fake-acr-server.mjs`'s own header for why a real HTTP
 * double is the only honest way to prove a real, schema-valid
 * `structure_needs` disclosure renders and round-trips. The NEGATIVE control
 * for this panel lives in "clarification chips"'s own decisive-answer test
 * above (a decisive answer is a decisive answer regardless of which panel
 * would have rendered for a non-decisive one), so it is not duplicated here.
 */
test.describe("structure needs chips", () => {
    test.use({ baseURL: configuredBaseURL });

    test("POSITIVE: a question ACR cannot resolve the kind for renders kind-offer chips, and a selection resolves it", async ({
        page,
    }) => {
        await page.goto("/");

        await page
            .getByLabel("Ask a question")
            .fill(`What's the status of this, ${TRIGGER_STRUCTURE_NEEDS}?`);
        await page.getByRole("button", { name: "Send" }).click();

        const panel = page.getByRole("region", { name: "More structure would narrow this" });
        await expect(panel).toBeVisible();
        await expect(page.getByRole("button", { name: "Select Pull request" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Select CI pipeline run" })).toBeVisible();

        // Discriminating, same rule as the clarification-chip control above:
        // `data-state` mirrors the result's own `status`, so "the panel is
        // present" cannot be conflated with "the panel is present AND the
        // result is actually non-decisive."
        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(1);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");

        // Picking an offer and confirming re-asks with the CHOSEN receipt —
        // proving the chip is wired all the way through the chat surface's
        // shared selection hook, the server hop, and the fake-ACR double's
        // own receipt check, not decorative.
        await page.getByRole("button", { name: "Select Pull request" }).click();
        await page.getByRole("button", { name: "Ask again with these selections" }).click();

        await expect(turns).toHaveCount(2);
        // The first turn is frozen at its original (clarification) state...
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");
        // ...and the SECOND turn is the discriminating proof: it can only be
        // "complete" if the fake-ACR double actually recognized the chosen
        // structure receipt and returned a decisive result, not another
        // clarification.
        await expect(turns.last()).toHaveAttribute("data-state", "complete");

        // No NEW re-askable structure-needs panel appeared — the decisive
        // second turn carries no `structure_needs`, so its own panel never
        // renders at all. StructureNeedsPanel (unlike ClarificationPanel)
        // keeps its heading even when frozen (only its footer action
        // changes — see StructureNeedsPanel.tsx), so exactly ONE region
        // remains: the superseded first turn's own frozen echo.
        await expect(
            page.getByRole("region", { name: "More structure would narrow this" }),
        ).toHaveCount(1);
        await expect(
            page.getByRole("button", { name: "Ask again with these selections" }),
        ).toHaveCount(0);
        // The superseded turn's own panel is still on screen, but frozen:
        // inspection only, same rule as ClarificationPanel's own
        // `cannot-choose-here` echo.
        await expect(page.getByTestId("cannot-confirm-structure-here")).toBeVisible();
    });
});
