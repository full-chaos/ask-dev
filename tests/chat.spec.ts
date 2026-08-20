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
 * Composer ergonomics and autoscroll (UX-equivalence pass). Runs against the
 * SAME unconfigured instance as "Ask Dev chat shell" above — every ask here
 * fails honestly (`workbench_misconfigured`, not retryable), which is exactly
 * what these controls need: draft-preservation and the not-retryable NEGATIVE
 * control need a real failure, not an answer, and none of this exercises
 * receipt/selection logic (that's covered by "clarification chips"/"structure
 * needs chips" above).
 */
test.describe("composer ergonomics", () => {
    test("Enter sends; Shift+Enter inserts a newline instead", async ({ page }) => {
        await page.goto("/");
        const box = page.getByLabel("Ask a question");

        await box.fill("First line");
        await box.press("Shift+Enter");
        await box.type("Second line");

        // Shift+Enter must NOT have sent anything — still zero turns, and the
        // newline it inserted is still sitting in the box.
        await expect(page.getByRole("article", { name: "Deterministic answer" })).toHaveCount(0);
        await expect(page.getByRole("alert", { name: "No answer" })).toHaveCount(0);
        await expect(box).toHaveValue("First line\nSecond line");

        // Plain Enter DOES send — the discriminating half of this control.
        await box.press("Enter");
        await expect(page.getByRole("alert", { name: "No answer" })).toBeVisible();
    });

    test("a failed ask preserves the draft, selected, for editing — never retyping", async ({
        page,
    }) => {
        await page.goto("/");
        const box = page.getByLabel("Ask a question");
        const question = "What is the status of dev-health-ops?";

        await box.fill(question);
        await page.getByRole("button", { name: "Send" }).click();

        await expect(page.getByRole("alert", { name: "No answer" })).toBeVisible();
        // The draft is exactly what was sent, not cleared — and it is the
        // user turn's own text too, so the box isn't just coincidentally
        // showing leftover state.
        await expect(box).toHaveValue(question);
        await expect(
            page.getByRole("log", { name: "Conversation" }).getByText(question, { exact: true }),
        ).toBeVisible();
        // Selected (codex-ready to type-over), verified via the DOM selection
        // range rather than a screenshot.
        await expect(async () => {
            const selection = await box.evaluate(
                (el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart,
            );
            expect(selection).toBe(question.length);
        }).toPass();
    });

    test("NEGATIVE: a not-retryable failure offers no Retry action", async ({ page }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        const failure = page.getByRole("alert", { name: "No answer" });
        await expect(failure).toBeVisible();
        await expect(failure.getByText(/not retryable/)).toBeVisible();
        await expect(failure.getByRole("button", { name: "Retry" })).toHaveCount(0);
    });

    test("POSITIVE: a retryable failure offers a Retry action that re-asks", async ({ page }) => {
        await page.goto("/");
        // The only way to reach `acr_unreachable` (retryable) without ACR
        // configured is a dead server hop — a genuine network-level failure,
        // not a fabricated answer. This is the SAME class of thing
        // `tests/chat.spec.ts` already tests honestly (a real failure
        // presenting as a failure); aborting the request tests that this
        // lane's OWN retry affordance reacts to it, it does not stand in for
        // the fake-ACR double or invent any ACR response.
        await page.route("**/api/investigations", (route) => route.abort("failed"));

        await page.getByLabel("Ask a question").fill("What is the status of dev-health-ops?");
        await page.getByRole("button", { name: "Send" }).click();

        const failures = page.getByRole("alert", { name: "No answer" });
        await expect(failures).toHaveCount(1);
        await expect(failures.first().getByText(/retryable/)).toBeVisible();
        const retry = failures.first().getByRole("button", { name: "Retry" });
        await expect(retry).toBeVisible();

        // Un-abort, then retry: the SAME question re-asks (not a re-typed
        // one), appending a fresh turn rather than mutating the frozen one —
        // this repo's "always append, never mutate" rule holds for a retry
        // exactly as it does for a clarification/structure re-ask.
        await page.unroute("**/api/investigations");
        await retry.click();

        await expect(failures).toHaveCount(2);
        await expect(failures.first().getByText(/retryable/)).toBeVisible();
        await expect(failures.last().getByText(/workbench_misconfigured/)).toBeVisible();
        // The now-superseded turn's OWN Retry is gone — only the latest
        // turn's failure can still act, same "only the latest turn is live"
        // rule the clarification/structure chips hold.
        await expect(failures.first().getByRole("button", { name: "Retry" })).toHaveCount(0);
    });

    test("autoscroll pins to the latest turn, and offers Jump to latest after scrolling away", async ({
        page,
    }) => {
        await page.goto("/");
        const box = page.getByLabel("Ask a question");
        const timeline = page.getByRole("log", { name: "Conversation" });

        // Enough turns to make the timeline scrollable.
        for (let i = 0; i < 6; i += 1) {
            await box.fill(`Question ${i}?`);
            await page.getByRole("button", { name: "Send" }).click();
            await expect(page.getByRole("alert", { name: "No answer" })).toHaveCount(i + 1);
        }

        // Pinned to bottom by default: the affordance is absent, and the
        // timeline is scrolled as far down as it can go.
        const jumpToLatest = page.getByRole("button", { name: "Jump to latest ↓" });
        await expect(jumpToLatest).toHaveCount(0);
        await expect(async () => {
            const atBottom = await timeline.evaluate(
                (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2,
            );
            expect(atBottom).toBe(true);
        }).toPass();

        // Scroll away, then ask again: autoscroll must NOT yank the view, and
        // the affordance must appear instead.
        await timeline.evaluate((el) => {
            el.scrollTop = 0;
        });
        await box.fill("One more, sent while scrolled away?");
        await page.getByRole("button", { name: "Send" }).click();
        await expect(page.getByRole("alert", { name: "No answer" })).toHaveCount(7);

        await expect(jumpToLatest).toBeVisible();
        const scrollTopWhileAway = await timeline.evaluate((el) => el.scrollTop);
        expect(scrollTopWhileAway).toBeLessThan(50);

        // Clicking it returns to the bottom and dismisses itself.
        await jumpToLatest.click();
        await expect(jumpToLatest).toHaveCount(0);
        await expect(async () => {
            const atBottom = await timeline.evaluate(
                (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2,
            );
            expect(atBottom).toBe(true);
        }).toPass();
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
