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
// Kept in sync by hand with `TRIGGER_CANDIDATE_NEEDS` for the same reason.
const TRIGGER_CANDIDATE_NEEDS = "e2e-candidate-me";
// Kept in sync by hand with `TRIGGER_MIXED` for the same reason.
const TRIGGER_MIXED = "e2e-mixed-me";
// Kept in sync by hand with `TRIGGER_COHORT` for the same reason.
const TRIGGER_COHORT = "e2e-cohort-me";
// Kept in sync by hand with `TRIGGER_CONVERSATION_ECHO` for the same reason.
const TRIGGER_CONVERSATION_ECHO = "e2e-conversation-echo";

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

    // Configured baseURL: a SUCCESSFUL retry needs a real decisive answer to
    // land, which the unconfigured instance can never produce. Same fake-ACR
    // double the "clarification chips"/"structure needs chips" blocks use —
    // an ordinary question with neither trigger keyword answers decisively
    // (see the NEGATIVE control in "clarification chips" below).
    test("a successful Retry clears the composer draft — no stale text left to accidentally resend", async ({
        page,
    }) => {
        await page.goto(configuredBaseURL);
        await page.route("**/api/investigations", (route) => route.abort("failed"));

        const question = "What is the status of dev-health-ops?";
        await page.getByLabel("Ask a question").fill(question);
        await page.getByRole("button", { name: "Send" }).click();

        const retry = page
            .getByRole("alert", { name: "No answer" })
            .getByRole("button", { name: "Retry" });
        await expect(retry).toBeVisible();
        await expect(page.getByLabel("Ask a question")).toHaveValue(question);

        await page.unroute("**/api/investigations");
        await retry.click();

        // The retry answered decisively (codex round 2 regression check):
        // the composer is EMPTY, not still showing the already-answered
        // question selected and one accidental Enter away from resending it.
        await expect(page.getByRole("article", { name: "Deterministic answer" })).toHaveAttribute(
            "data-state",
            "complete",
        );
        await expect(page.getByLabel("Ask a question")).toHaveValue("");
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

        // CHAOS-4671: the offer now lives in the floating popup anchored
        // above the composer (`role="dialog"`, `aria-label` = the fake-ACR
        // double's own `clarification_prompt`), not an inline transcript
        // region — see ClarificationPopup.tsx's own header and
        // page.test.tsx's identical `popupOptionButton()` convention for
        // why an option's accessible name is its bare label, never the old
        // inline panels' "Select X".
        const dialog = page.getByRole("dialog", { name: "Did you mean Ask Dev or Atlas?" });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask Dev" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Atlas" })).toBeVisible();

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

        // Selecting leads, confirming follows (CHAOS-4343): the subject
        // page is multi-select (ClarificationPopup.tsx's `selectMode`), so
        // the toggle alone must not fire a request — only "Continue with N
        // selected" does, proving the popup is wired, not decorative.
        await page.getByRole("button", { name: "Ask Dev" }).click();
        await expect(turns).toHaveCount(1);
        await page.getByRole("button", { name: "Continue with 1 selected" }).click();

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

        // The popup closed — the decisive second turn carries nothing left
        // to clarify, so no dialog remains anywhere on the page.
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // The superseded clarification turn is still on screen, but frozen:
        // a collapsed "how this was resolved" disclosure, not a live
        // control — CHAOS-4671 replaces the old inert "shown for inspection
        // only" panel (`cannot-choose-here`) with this.
        await expect(turns.first().getByTestId("frozen-offers-disclosure")).toBeVisible();
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
        await expect(page.getByRole("button", { name: /^Select /u })).toHaveCount(0);
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
 * Popup width vs the chat column (CHAOS-4695).
 *
 * chris's live screenshot (2026-08-31 16:30) showed the popup rendering
 * narrower than the chat surface and visibly off-center against the
 * composer and the answer cards above it. `ClarificationPopup.tsx`'s own
 * header states the popup is a DOM SIBLING of `ChatComposer` inside the
 * same `.chat__composer-bar` — so the two must share the same layout width
 * at desktop widths, not a fixed intrinsic max-width that floats narrower.
 */
test.describe("clarification popup width (CHAOS-4695)", () => {
    test.use({ baseURL: configuredBaseURL });

    test("the popup spans the same width as the chat composer, not a fixed intrinsic width", async ({
        page,
    }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill(`Who owns this, ${TRIGGER_CLARIFICATION}?`);
        await page.getByRole("button", { name: "Send" }).click();

        const dialog = page.getByRole("dialog", { name: "Did you mean Ask Dev or Atlas?" });
        await expect(dialog).toBeVisible();

        const composer = page.locator(".chat-composer");
        const [dialogBox, composerBox] = await Promise.all([
            dialog.boundingBox(),
            composer.boundingBox(),
        ]);
        if (dialogBox === null || composerBox === null) {
            throw new Error("expected both the popup and the composer to have a layout box");
        }

        // Same left edge and same width — not just "close enough to
        // overlap". A fixed intrinsic max-width narrower than the composer
        // is exactly the CHAOS-4695 defect this pins.
        expect(dialogBox.width).toBeCloseTo(composerBox.width, 0);
        expect(dialogBox.x).toBeCloseTo(composerBox.x, 0);
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

        // CHAOS-4671: the kind offer lives in the floating popup, not the
        // old inline "More structure would narrow this" region.
        const dialog = page.getByRole("dialog", { name: "Which kind of thing is this about?" });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole("button", { name: "Pull request" })).toBeVisible();
        await expect(page.getByRole("button", { name: "CI pipeline run" })).toBeVisible();

        // Discriminating, same rule as the clarification-chip control above:
        // `data-state` mirrors the result's own `status`, so "the popup is
        // present" cannot be conflated with "the popup is present AND the
        // result is actually non-decisive."
        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(1);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");

        // The kind page is single-select (ClarificationPopup.tsx's own
        // `pick()`): picking an offer IS confirming — it advances/completes
        // on its own, no separate confirm click — proving the chip is
        // wired all the way through the chat surface's shared selection
        // hook, the server hop, and the fake-ACR double's own receipt
        // check, not decorative.
        await page.getByRole("button", { name: "Pull request" }).click();

        await expect(turns).toHaveCount(2);
        // The first turn is frozen at its original (clarification) state...
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");
        // ...and the SECOND turn is the discriminating proof: it can only be
        // "complete" if the fake-ACR double actually recognized the chosen
        // structure receipt and returned a decisive result, not another
        // clarification.
        await expect(turns.last()).toHaveAttribute("data-state", "complete");

        // No new popup reappeared — the decisive second turn carries no
        // `structure_needs`, so there is nothing left to ask.
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // The superseded turn's own offer is still on screen, but frozen:
        // a collapsed "how this was resolved" disclosure, not a live
        // control — replaces the old inert `cannot-confirm-structure-here`
        // panel.
        await expect(turns.first().getByTestId("frozen-offers-disclosure")).toBeVisible();
    });

    /**
     * CHAOS-4171/CHAOS-4012: the candidate-list axis, real-HTTP round trip —
     * same proof shape as the kind-offer test above, one member over
     * (`subject_candidate` instead of `expected_kind`).
     */
    test("POSITIVE: a question ACR cannot commit a subject for renders candidate-offer chips, and a selection resolves it", async ({
        page,
    }) => {
        await page.goto("/");

        await page
            .getByLabel("Ask a question")
            .fill(`What's the status of this, ${TRIGGER_CANDIDATE_NEEDS}?`);
        await page.getByRole("button", { name: "Send" }).click();

        // CHAOS-4671: the candidate offers live in the floating popup, not
        // the old inline "More structure would narrow this" region.
        const dialog = page.getByRole("dialog", { name: "Did you mean one of these?" });
        await expect(dialog).toBeVisible();
        await expect(
            page.getByRole("button", { name: "WORK-9001: Investigate flaky test" }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "WORK-9002: Rotate signing key" }),
        ).toBeVisible();

        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(1);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");

        // The candidate axis is multi-select (CHAOS-4343): picking toggles
        // in place, and "Continue with N selected" fires the re-ask.
        await page.getByRole("button", { name: "WORK-9001: Investigate flaky test" }).click();
        await page.getByRole("button", { name: "Continue with 1 selected" }).click();

        await expect(turns).toHaveCount(2);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");
        // The discriminating proof: the second turn can only be "complete"
        // if the fake-ACR double actually recognized the chosen candr_
        // receipt and returned a decisive result.
        await expect(turns.last()).toHaveAttribute("data-state", "complete");
        await expect(page.getByRole("dialog")).toHaveCount(0);
    });
});

/**
 * Mixed-receipt-family unification (CHAOS-3927 P2 follow-up, codex review on
 * PR #3 + re-confirmed on PR #4).
 *
 * Co-presence of a subject-candidate clarification AND a structure_needs
 * disclosure on the SAME result is legal on the pinned schema — the two are
 * independent optional fields, nothing forbids both being set at once — and
 * became wire-REACHABLE only once P1 landed (before that, `structure_needs`
 * did not exist as a field at all). The bug this control proves fixed: a
 * tester who accumulates structure picks (without confirming them) and THEN
 * picks a subject candidate used to lose those picks entirely — `chooseCandidate`
 * fired the re-ask with only the subject receipt, and `ask()` resetting the
 * shared selection hook silently dropped the rest.
 */
test.describe("mixed receipt families", () => {
    test.use({ baseURL: configuredBaseURL });

    test("POSITIVE: picking a subject candidate carries along an unconfirmed structure pick, mutation-proven", async ({
        page,
    }) => {
        await page.goto("/");

        await page.getByLabel("Ask a question").fill(`Who owns this, ${TRIGGER_MIXED}?`);
        await page.getByRole("button", { name: "Send" }).click();

        // CHAOS-4671: a turn carrying BOTH a subject-candidate
        // clarification AND a structure_needs disclosure now pages through
        // the SAME floating popup as a 2-question stepper ("x of y"), one
        // question per page — not two panels stacked in the transcript.
        // The co-presence this scenario exists to prove is reachable and
        // rendered, not just schema-legal in the abstract.
        const page1 = page.getByRole("dialog", { name: "Which kind of thing is this about?" });
        await expect(page1).toBeVisible();
        await expect(page1.getByText("1 of 2")).toBeVisible();
        // No inline panel anywhere — the popup is the ONLY rendering of the
        // offer.
        await expect(
            page.getByRole("region", { name: "More structure would narrow this" }),
        ).toHaveCount(0);

        // Accumulate a structure pick WITHOUT confirming it — the exact
        // state the bug dropped. The kind page is single-select, so picking
        // auto-advances to the subject page rather than firing a request.
        await page.getByRole("button", { name: "Pull request" }).click();

        // Now resolve the subject instead of confirming structure on its
        // own page. The fake-ACR double's mixed scenario (see
        // fake-acr-server.mjs) only resolves decisively when BOTH
        // `prior_subject_receipts` and a recognized `prior_kind_receipts`
        // entry arrive on the SAME request — so this is a genuine
        // mutation-provable positive control: revert `chooseStructure` to
        // dropping the earlier-page structure pick, and the second turn
        // stays `clarification_required` instead of turning `complete`.
        const page2 = page.getByRole("dialog", { name: "Did you mean Ask Dev or Atlas?" });
        await expect(page2).toBeVisible();
        await expect(page2.getByText("2 of 2")).toBeVisible();
        await page.getByRole("button", { name: "Ask Dev" }).click();
        await page.getByRole("button", { name: "Continue with 1 selected" }).click();

        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(2);
        await expect(turns.first()).toHaveAttribute("data-state", "clarification_required");
        await expect(turns.last()).toHaveAttribute("data-state", "complete");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // The superseded turn shows no live controls for EITHER family —
        // one collapsed "how this was resolved" disclosure per family
        // (structure_needs, subject_resolution), the same rule
        // page.test.tsx's identical unit-level scenario pins.
        await expect(turns.first().getByTestId("frozen-offers-disclosure")).toHaveCount(2);
    });
});

/**
 * Conversation threading (chat-surface follow-up context).
 *
 * The pinned request contract declares `conversation?: ConversationTurn[]`;
 * the chat surface used to hardcode `conversation: []` on every ask, so a
 * follow-up question ran as an independent investigation with no memory of
 * the turn before it. This proves turn 2's re-ask actually threads turn 1's
 * own content — a real HTTP round trip through the server hop, not a
 * client-side-only assertion.
 */
test.describe("conversation threading", () => {
    test.use({ baseURL: configuredBaseURL });

    test("POSITIVE: turn 2 carries turn 1 as prior conversation context", async ({ page }) => {
        await page.goto("/");

        await page
            .getByLabel("Ask a question")
            .fill(`What is Ask Dev, ${TRIGGER_CONVERSATION_ECHO}?`);
        await page.getByRole("button", { name: "Send" }).click();

        const turns = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turns).toHaveCount(1);
        // A turn's own FIRST ask carries no prior conversation.
        await expect(turns.first()).toContainText("conversation_turns=0");

        await page
            .getByLabel("Ask a question")
            .fill(`Follow-up question, ${TRIGGER_CONVERSATION_ECHO}?`);
        await page.getByRole("button", { name: "Send" }).click();

        await expect(turns).toHaveCount(2);
        // The discriminating proof: the SERVER, not just the client, saw
        // turn 1's own user question inside `conversation` — the fake-ACR
        // double echoes back exactly what it received (see
        // fake-acr-server.mjs's own `conversationEchoResult`).
        await expect(turns.last()).toContainText("conversation_turns=2");
        await expect(turns.last()).toContainText("What is Ask Dev");
    });
});

/**
 * The cohort ranking, end to end (CHAOS-4449).
 *
 * Runs against the ACR-configured instance, so the ranked cohort travels the
 * WHOLE real path — fake-ACR's HTTP response → the app's own Ajv validation
 * against the pinned schemas → the DOM. That validation is the point: the
 * pinned contract is `additionalProperties: false`, so a result carrying
 * `score`/`outcome`/`data_completeness`/`drivers` on a cohort member is
 * rejected outright on any pin older than this one. A green run here is
 * therefore also a live proof that the pin bump itself landed.
 *
 * `TRIGGER_COHORT` is required: the canonical example carries the ranked
 * cohort but its own `interpretation.shape` is `single_subject`, and the
 * table is gated on cohort intent. That makes the UNMODIFIED answer the
 * negative control below — a pairing that only works because the double
 * overrides `shape` and nothing else.
 */
test.describe("cohort ranking", () => {
    test.use({ baseURL: configuredBaseURL });

    test("POSITIVE: a decisive cohort answer renders the ranking table and its drivers", async ({
        page,
    }) => {
        await page.goto("/");

        await page
            .getByLabel("Ask a question")
            .fill(`Which teams are struggling, and why, ${TRIGGER_COHORT}?`);
        await page.getByRole("button", { name: "Send" }).click();

        const turn = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turn).toHaveCount(1);
        // Decisive, not a clarification the UI merely rendered thinly.
        await expect(turn).toHaveAttribute("data-state", "complete");

        const rows = page.getByTestId("ranking-row");
        await expect(rows).toHaveCount(1);
        // The score AND the outcome that qualifies it — never a bare score.
        await expect(rows.first()).toContainText("CHAOS");
        await expect(rows.first()).toContainText("43.5");
        await expect(rows.first()).toContainText("qualified");
        await expect(rows.first()).toContainText("complete");
        // The two strongest drivers, strongest first.
        await expect(rows.first()).toContainText("operational deficiencies.severity");
        await expect(rows.first()).toContainText("health.compounding risk");

        // The member acr did not rank is named, not silently dropped.
        await expect(page.getByTestId("unranked-members")).toContainText("Platform");

        // The §5a narration behind the ranking: an inferred judgment, the
        // subject it is about, and the claimed fact it cites.
        // Scoped to the cohort driver's OWN record, not the first driver on
        // the page: the result carries the example's pre-existing drivers
        // too, and asserting on `.first()` would pass while saying nothing
        // about the cohort narration this test exists for.
        const cohortDriver = page
            .locator("li.record")
            .filter({ hasText: "CHAOS: operational deficiencies" });
        await expect(cohortDriver).toHaveCount(1);
        await expect(cohortDriver).toContainText("inferred");
        await expect(cohortDriver.getByTestId("driver-affected-subjects")).toContainText(
            "CHAOS (team)",
        );
        // The claimed fact the judgment cites, verbatim.
        await expect(cohortDriver).toContainText("claim_cohort_88cad88367c815eae568ce1f979c1471");
    });

    test("NEGATIVE: a single_subject answer carrying cohort data renders no ranking table", async ({
        page,
    }) => {
        // The unmodified canonical example: it DOES carry a ranked team
        // cohort, and its `interpretation.shape` is `single_subject`. A rich
        // view must be conditional on intent (AGENTS.md check 10), so the
        // table must not appear even though the data is right there.
        await page.goto("/");

        await page.getByLabel("Ask a question").fill("Why is Ask Dev still not ready to ship?");
        await page.getByRole("button", { name: "Send" }).click();

        const turn = page.getByRole("article", { name: "Deterministic answer" });
        await expect(turn).toHaveAttribute("data-state", "complete");
        // Discriminating: the answer really did arrive and really does carry
        // the cohort's own driver narration — so this is the gate closing,
        // not the request having failed.
        await expect(turn).toContainText("CHAOS: operational deficiencies");
        await expect(page.getByTestId("cohort-ranking-panel")).toHaveCount(0);
        await expect(page.getByTestId("ranking-row")).toHaveCount(0);
    });
});
