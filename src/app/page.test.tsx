import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/page";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
/** The fixture's own `subject_resolution.clarification_prompt` — ACR's wording, verbatim, is the popup page's title (never Ask Dev's own chrome). `mixed`/`mixedCandidates` below clone `clarification`, so they share this same prompt. */
const CLARIFICATION_PROMPT = clarification.subject_resolution.clarification_prompt!;
const structureKind = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-kind",
)!.result;
const structureCandidate = structureMockScenarios().find(
    (scenario) => scenario.id === "structure-candidate",
)!.result;

/**
 * Mixed-receipt-family unification (CHAOS-3927 P2 follow-up): both a
 * subject-candidate clarification AND a structure_needs disclosure on the
 * SAME result — legal on the pinned schema, wire-reachable only since P1.
 */
const mixed: InvestigationResult = {
    ...structuredClone(clarification),
    result_id: "result_mixed_0001",
    request_id: "request_mixed_0001",
    structure_needs: structureKind.structure_needs!,
};

/**
 * CHAOS-4343 items 1/2, codex review round 2: BOTH multi-select candidate
 * axes on the SAME result — `subject_resolution.candidates`
 * (`ClarificationPanel`) AND `structure_needs.candidate_options`
 * (`StructureNeedsPanel`) at once. A pending pick in whichever axis the
 * tester does NOT explicitly confirm must still ride along, not be dropped.
 */
const mixedCandidates: InvestigationResult = {
    ...structuredClone(clarification),
    result_id: "result_mixed_candidates_0001",
    request_id: "request_mixed_candidates_0001",
    structure_needs: structureCandidate.structure_needs!,
};

function respondWith(body: unknown): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    );
}

async function ask(question: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Ask a question"), question);
    await user.click(screen.getByRole("button", { name: "Send" }));
    return user;
}

/**
 * CHAOS-4671: every offer now lives in the floating `ClarificationPopup`
 * (`role="dialog"`, `aria-label` = the current page's question), not an
 * inline `region`. An option's accessible name is its `displayText` alone —
 * the number tile and the selected checkmark are both `aria-hidden`, unlike
 * the old inline panels' "Select X"/"Unselect X" button copy.
 */
function popupOptionButton(label: string): HTMLElement {
    return screen.getByRole("button", { name: label });
}

async function pickPopupOption(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(await screen.findByRole("button", { name: label }));
}

/** The multi-select page's own explicit confirm — see `ClarificationPopup`'s own header for why single-select pages need no equivalent (picking already IS confirming). */
function continueButton(): HTMLElement {
    return screen.getByRole("button", { name: /^Continue/ });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the chat surface's empty state", () => {
    it("shows a real empty state, not a mock answer", () => {
        render(<ChatPage />);

        expect(screen.getByText("Ask a question to start an investigation.")).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Deterministic answer" })).toBeNull();
    });
});

describe("asking a question appends a user turn and an assistant turn", () => {
    it("renders the question as its own turn and the answer under it", async () => {
        respondWith({ result: answered });
        render(<ChatPage />);

        await ask("What is the status of dev-health-ops?");

        expect(
            await screen.findByText("What is the status of dev-health-ops?"),
        ).toBeInTheDocument();
        expect(
            await screen.findByRole("article", { name: "Deterministic answer" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByText("Ask a question to start an investigation."),
        ).not.toBeInTheDocument();
        // No popup at all when the result carries nothing to clarify.
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps every prior turn visible after a second question", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("First question?");
        await screen.findByRole("article", { name: "Deterministic answer" });
        await ask("Second question?");

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByText("First question?")).toBeInTheDocument();
        expect(await screen.findByText("Second question?")).toBeInTheDocument();
        expect(screen.getAllByRole("article", { name: "Deterministic answer" })).toHaveLength(2);
    });
});

describe("a failure renders as a failure, in its own turn", () => {
    it("shows the failure panel and no answer surface", async () => {
        respondWith({
            failure: {
                code: "workbench_misconfigured",
                message: "Ask Dev's server is not configured.",
                retryable: false,
            },
        });
        render(<ChatPage />);

        await ask("What is the status of dev-health-ops?");

        expect(await screen.findByRole("alert", { name: "No answer" })).toBeInTheDocument();
        expect(screen.queryByRole("article", { name: "Deterministic answer" })).toBeNull();
    });
});

describe("the clarification popup is live only on the most recent assistant turn (CHAOS-4671)", () => {
    it("floats a popup above the composer with the candidates as numbered options", async () => {
        respondWith({ result: clarification });
        render(<ChatPage />);

        await ask("Is Atlas on track?");

        const dialog = await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        expect(dialog).toBeInTheDocument();
        // No inline offer panel anywhere in the transcript — the popup is the
        // ONLY place the offers render (ticket acceptance).
        expect(screen.queryByRole("region", { name: CLARIFICATION_PROMPT })).toBeNull();
        for (const candidate of clarification.subject_resolution.candidates) {
            expect(
                within(dialog).getByRole("button", { name: candidate.subject.label }),
            ).toBeInTheDocument();
        }
    });

    /**
     * CHAOS-4343 items 1/2 (ported to the popup): selection leads (a toggle,
     * not an immediate fire), the page's own "Continue" confirm follows. A
     * single confirmed selection still re-asks with exactly that candidate's
     * receipt, unchanged from before — only the UI path to get there moved.
     */
    it("re-asks with the chosen receipt, closes the popup, and leaves no inline offer panel on the older turn", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const candidate = clarification.subject_resolution.candidates[0]!;
        await pickPopupOption(user, candidate.subject.label);
        await user.click(continueButton());

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([
            { result_id: clarification.result_id, receipt_id: candidate.receipt_id },
        ]);
        // The question that produced the CLARIFICATION travels unchanged, not
        // the composer's original text — same rule the Workbench holds.
        expect(secondCallBody.question).toBe(clarification.question);

        // Popup closed once the flow completed and answered (a fresh
        // decisive result has nothing left to clarify).
        expect(screen.queryByRole("dialog")).toBeNull();

        // The now-superseded clarification turn renders NO inline offer
        // panel, dead or otherwise — a collapsed disclosure, no controls.
        expect(screen.queryByRole("button", { name: candidate.subject.label })).toBeNull();
        expect(screen.getByTestId("frozen-offers-disclosure")).toBeInTheDocument();
        expect(screen.queryByTestId("cannot-choose-here")).toBeNull();

        // Discriminating, not just "an article rendered": both turns share
        // the same `aria-label`, so `data-state` is what actually proves the
        // FIRST turn stayed a clarification and the SECOND turn is decisive.
        const turns = screen.getAllByRole("article", { name: "Deterministic answer" });
        expect(turns).toHaveLength(2);
        expect(turns[0]).toHaveAttribute("data-state", "clarification_required");
        expect(turns[1]).toHaveAttribute("data-state", answered.status);
    });

    /**
     * CHAOS-4343 item 2, the ticket's own acceptance scenario, ported to the
     * popup's multi-select page: N selected candidates fire N INDEPENDENT
     * turn-2 requests and land as N stacked assistant turns, each with its
     * own status — never one request carrying several candidate receipts.
     */
    it("confirming 2 selected candidates fires 2 independent requests and renders 2 stacked panels", async () => {
        const [first, second] = clarification.subject_resolution.candidates;
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await pickPopupOption(user, first!.subject.label);
        await user.click(popupOptionButton(second!.subject.label));
        await user.click(continueButton());

        expect(
            await screen.findAllByRole("article", { name: "Deterministic answer" }),
        ).toHaveLength(3);
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        const thirdCallBody = JSON.parse(fetchSpy.mock.calls[2]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([
            { result_id: clarification.result_id, receipt_id: first!.receipt_id },
        ]);
        expect(thirdCallBody.priorSubjectReceipts).toEqual([
            { result_id: clarification.result_id, receipt_id: second!.receipt_id },
        ]);
        // Both fired requests resend the SAME unchanged question.
        expect(secondCallBody.question).toBe(clarification.question);
        expect(thirdCallBody.question).toBe(clarification.question);

        // CHAOS-4670: the batch action fires real requests (asserted above)
        // but renders NO new user bubble at all — only the ORIGINAL ask's
        // own bubble stays visible, for the whole batch, not one per fired
        // request and not one for the batch as a whole either.
        expect(screen.getAllByText(clarification.question)).toHaveLength(1);

        // Each panel's own choice notice proves it resolved to the RIGHT
        // candidate independently, since both requests share one question.
        expect(
            await screen.findByText(new RegExp(`about ${first!.subject.label}`, "i")),
        ).toBeInTheDocument();
        expect(
            screen.getByText(new RegExp(`about ${second!.subject.label}`, "i")),
        ).toBeInTheDocument();

        // Only the LATEST of the 3 turns is live; the first two are frozen.
        const turns = screen.getAllByRole("article", { name: "Deterministic answer" });
        expect(turns[0]).toHaveAttribute("data-state", "clarification_required");
        expect(turns[1]).toHaveAttribute("data-state", answered.status);
        expect(turns[2]).toHaveAttribute("data-state", answered.status);
    });

    /**
     * Item 2's status independence: one candidate's request can fail while
     * the other succeeds, and each panel shows its own outcome.
     */
    it("each fired request settles its own panel independently, including a mixed success/failure pair", async () => {
        const [first, second] = clarification.subject_resolution.candidates;
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        failure: {
                            code: "acr_unreachable",
                            message: "ACR could not be reached.",
                            retryable: true,
                        },
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await pickPopupOption(user, first!.subject.label);
        await user.click(popupOptionButton(second!.subject.label));
        await user.click(continueButton());

        // The failed panel settles (proving independence — it does not wait
        // on the successful one), and the successful one still shows its own
        // answer article alongside it rather than being replaced or hidden.
        expect(await screen.findByRole("alert", { name: "No answer" })).toBeInTheDocument();
        const articles = screen.getAllByRole("article", { name: "Deterministic answer" });
        // The original clarification turn, plus the one candidate that
        // answered successfully — the failed candidate has no article at all.
        expect(articles).toHaveLength(2);
        expect(articles[1]).toHaveAttribute("data-state", answered.status);
    });

    /** CHAOS-4671 dismiss: X closes the popup with no re-ask — "proceed without the selection". */
    it("X dismisses the popup without firing a re-ask, and the chat input stays usable", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        await user.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Typing a normal reply is always allowed, dismissed popup or not.
        await ask("A completely different question?");
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    /**
     * codex round 3 (chaos-4671-20260831T120929.md): Dismiss unmounts the
     * popup but never restores focus, so a keyboard user's focus falls back
     * to `document.body` — they must re-navigate (click, or Tab from the
     * top) before they can keep typing. `ask()`'s own `userEvent.type` call
     * would mask this (it focuses its target itself), so this test reads
     * `document.activeElement` directly instead.
     */
    it("Dismiss returns focus to the composer, without the caller re-focusing it", async () => {
        respondWith({ result: clarification });
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const dismissButton = await screen.findByRole("button", { name: "Dismiss" });
        dismissButton.focus();
        await user.keyboard("{Enter}");

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(screen.getByLabelText("Ask a question"));
    });

    /**
     * CHAOS-4671 keyboard nav, single-select page: a number key picks AND
     * confirms in one keystroke (there is nothing else to accumulate on a
     * one-page, single-select result) — the ticket's own "1..N, selectable
     * by number key" mapping.
     */
    it("a number key picks and immediately confirms on a single-select page", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureKind }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("How's the pipeline doing?");
        const user = userEvent.setup();
        const dialog = await screen.findByRole("dialog", {
            name: "Which kind of thing is this about?",
        });
        const option = structureKind.structure_needs!.kind_options![1]!;
        dialog.focus();
        await user.keyboard("2");

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: structureKind.result_id, receipt_id: option.receipt_id },
        ]);
    });

    /**
     * CHAOS-4671 keyboard nav, multi-select page: ↑↓ moves focus, Enter
     * TOGGLES the focused option (never auto-confirms — see
     * `ClarificationPopup`'s own header for why a multi-select page needs an
     * explicit "Continue" the way a single-select page does not).
     */
    it("↑↓ moves focus and Enter toggles the focused option on a multi-select page", async () => {
        respondWith({ result: clarification });
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const dialog = await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        const [first, second] = clarification.subject_resolution.candidates;
        dialog.focus();
        await user.keyboard("{ArrowDown}");
        await user.keyboard("{Enter}");

        expect(within(dialog).getByRole("button", { name: second!.subject.label })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        expect(within(dialog).getByRole("button", { name: first!.subject.label })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
    });
});

/**
 * CHAOS-4670: a panel selection's turn-2 request resends the SAME question
 * text as the turn it supersedes — it still runs for real on the wire
 * (asserted below via the second fetch call's body, unchanged from the
 * pre-existing tests above), but must not render as a second user bubble.
 * The compact record of what the re-run carried is the superseded turn's
 * own selection chips, already covered by the tests above. Ported to
 * popup interactions (CHAOS-4671) — the wire/bubble behavior under test is
 * unchanged, only the UI path to trigger it moved.
 */
describe("CHAOS-4670: a panel-selection re-ask does not render a second question bubble", () => {
    it("renders exactly ONE user bubble after a subject-candidate re-ask", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const { container } = render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const candidate = clarification.subject_resolution.candidates[0]!;
        await pickPopupOption(user, candidate.subject.label);
        await user.click(continueButton());

        // The re-ask still ran for real, on the wire, unchanged.
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
        expect(await screen.findByText(clarification.question)).toBeInTheDocument();

        // But it must render as the transcript's ONLY user bubble.
        expect(container.querySelectorAll(".chat__turn--user")).toHaveLength(1);
        expect(screen.getAllByText(clarification.question)).toHaveLength(1);
    });

    it("renders exactly ONE user bubble after a structure-batch re-ask (chooseStructure's single-batch fallback)", async () => {
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureKind }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const { container } = render(<ChatPage />);

        await ask("How's the pipeline doing?");
        const user = userEvent.setup();
        const option = structureKind.structure_needs!.kind_options![1]!;
        await pickPopupOption(user, option.label);

        await waitFor(() =>
            expect(screen.getAllByRole("article", { name: "Deterministic answer" })).toHaveLength(
                2,
            ),
        );
        expect(container.querySelectorAll(".chat__turn--user")).toHaveLength(1);
        expect(screen.getAllByText("How's the pipeline doing?")).toHaveLength(1);
    });

    it("renders exactly ONE user bubble across 2 stacked panels from confirmSelections", async () => {
        const [first, second] = clarification.subject_resolution.candidates;
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const { container } = render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await pickPopupOption(user, first!.subject.label);
        await user.click(popupOptionButton(second!.subject.label));
        await user.click(continueButton());

        await waitFor(() =>
            expect(screen.getAllByRole("article", { name: "Deterministic answer" })).toHaveLength(
                3,
            ),
        );
        expect(container.querySelectorAll(".chat__turn--user")).toHaveLength(1);
    });
});

describe("structure-needs offers (CHAOS-3927 P2, now popup-only per CHAOS-4671)", () => {
    it("renders the kind offer as a single-select page and picking it fires the re-ask immediately", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureKind }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("How's the pipeline doing?");
        const user = userEvent.setup();
        const option = structureKind.structure_needs!.kind_options![1]!;
        // While the popup is live, there is NO duplicate inline offer panel
        // in the transcript — the popup is the ONLY rendering of the offer.
        await screen.findByRole("dialog", { name: "Which kind of thing is this about?" });
        expect(
            screen.queryByRole("region", { name: "More structure would narrow this" }),
        ).toBeNull();
        // A single-select page has no separate "Continue" — picking IS
        // confirming, since it is the only page in this result.
        await pickPopupOption(user, option.label);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: structureKind.result_id, receipt_id: option.receipt_id },
        ]);
        // CHAOS-4171 standing order: verify the CONSUMER, not just the
        // producer — `use-structure-selections.test.ts` proves the hook
        // queues the event, `route.test.ts` proves the route emits it; this
        // is the one place that proves `ask()` actually puts it on the wire.
        expect(secondCallBody.structureSelectionEvents).toEqual([
            { member: "expected_kind", outcome: "submitted" },
        ]);

        // The superseded turn renders a collapsed disclosure, no live
        // controls — the old "shown for inspection only" dead control is
        // gone entirely.
        expect(screen.getByTestId("frozen-offers-disclosure")).toBeInTheDocument();
        expect(screen.queryByTestId("cannot-confirm-structure-here")).toBeNull();
        expect(screen.queryByRole("button", { name: option.label })).toBeNull();
    });

    /**
     * CHAOS-4343 items 1/2, live-verified against the kiac path (chris's own
     * flow: kind + window + N candidates land on the SAME `structure_needs`
     * disclosure): confirming N selected `candidate_options` entries fires N
     * independent turn-2 requests, each its own stacked panel — the SAME
     * multi-select discipline the subject-resolution axis holds, applied to
     * this axis's own popup page.
     */
    it("confirming 2 selected structure candidates fires 2 independent requests and renders 2 stacked panels", async () => {
        const [first, second] = structureCandidate.structure_needs!.candidate_options!;
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: structureCandidate }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("What's going on with the flaky test work item?");
        const user = userEvent.setup();
        await pickPopupOption(user, first!.label);
        await user.click(popupOptionButton(second!.label));
        await user.click(continueButton());

        expect(
            await screen.findAllByRole("article", { name: "Deterministic answer" }),
        ).toHaveLength(3);
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        const thirdCallBody = JSON.parse(fetchSpy.mock.calls[2]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorCandidateReceipts).toEqual([
            { result_id: structureCandidate.result_id, receipt_id: first!.receipt_id },
        ]);
        expect(thirdCallBody.priorCandidateReceipts).toEqual([
            { result_id: structureCandidate.result_id, receipt_id: second!.receipt_id },
        ]);
        // Both fired requests resend the SAME unchanged question.
        expect(secondCallBody.question).toBe(structureCandidate.question);
        expect(thirdCallBody.question).toBe(structureCandidate.question);

        const turns = screen.getAllByRole("article", { name: "Deterministic answer" });
        expect(turns[0]).toHaveAttribute("data-state", "clarification_required");
        expect(turns[1]).toHaveAttribute("data-state", answered.status);
        expect(turns[2]).toHaveAttribute("data-state", answered.status);
    });
});

/**
 * Mixed-receipt-family unification (CHAOS-3927 P2 follow-up, codex review
 * round 1 + round 2), ported to the popup's multi-question stepper
 * (CHAOS-4671): both orders in which a tester can act on a turn that carries
 * BOTH a subject-candidate clarification and a structure_needs disclosure at
 * once — now TWO pages in ONE popup, not two panels stacked in the
 * transcript.
 */
describe("mixed receipt families page through the SAME popup as a 2-question stepper", () => {
    it("pages through both questions with an 'x of y' stepper", async () => {
        respondWith({ result: mixed });
        render(<ChatPage />);

        await ask("Who owns this?");
        const user = userEvent.setup();

        const page1 = await screen.findByRole("dialog", {
            name: "Which kind of thing is this about?",
        });
        expect(within(page1).getByText("1 of 2")).toBeInTheDocument();
        // No inline panel anywhere — this is the ONLY rendering of the offer.
        expect(
            screen.queryByRole("region", { name: "More structure would narrow this" }),
        ).toBeNull();

        await user.click(screen.getByRole("button", { name: "Next question" }));

        const page2 = await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        expect(within(page2).getByText("2 of 2")).toBeInTheDocument();
    });

    it("subject-first: picking a kind option advances to the subject page, and confirming there carries BOTH families", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: mixed }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Who owns this?");
        const user = userEvent.setup();
        const option = mixed.structure_needs!.kind_options![1]!;
        // Page 1 (single-select, not last): picking auto-ADVANCES, never fires yet.
        await pickPopupOption(user, option.label);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        const candidate = mixed.subject_resolution.candidates[0]!;
        await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        await user.click(popupOptionButton(candidate.subject.label));
        await user.click(continueButton());

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([
            { result_id: mixed.result_id, receipt_id: candidate.receipt_id },
        ]);
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: mixed.result_id, receipt_id: option.receipt_id },
        ]);
    });

    /**
     * codex round 2, finding 1's shape, ported: confirming the SUBJECT page
     * with nothing picked there ("Continue without selecting") still sends
     * the kind pick made on the earlier page — an unconfirmed pick from a
     * page the tester already passed through is never silently dropped.
     */
    it("structure-first: continuing past the subject page unanswered still sends only the earlier kind pick", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: mixed }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Who owns this?");
        const user = userEvent.setup();
        const option = mixed.structure_needs!.kind_options![1]!;
        await pickPopupOption(user, option.label);
        await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        await user.click(continueButton());

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([]);
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: mixed.result_id, receipt_id: option.receipt_id },
        ]);

        // The superseded turn shows no live controls for EITHER family — one
        // collapsed disclosure per family (structure_needs, subject_resolution).
        expect(screen.queryByTestId("cannot-choose-here")).toBeNull();
        expect(screen.queryByTestId("cannot-confirm-structure-here")).toBeNull();
        expect(screen.getAllByTestId("frozen-offers-disclosure")).toHaveLength(2);
    });
});

/**
 * CHAOS-4343 item 3: verifies the CONSUMER, not just the producer —
 * `kind-nouns.test.ts` proves `literalKindNounsInQuestion` itself,
 * `client.test.ts` proves `buildInvestigationRequest` attaches it,
 * `route.test.ts` proves the route parses it — this is the one place that
 * proves the chat surface's own `ask()` actually puts it on the wire, for a
 * FRESH question with no prior receipt at all (CHAOS-4171 standing order).
 */
describe("literal kind nouns bind as an explicit expectedKinds hint (CHAOS-4343 item 3)", () => {
    it("sends expectedKinds derived from a literal kind noun in a brand-new question", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ result: answered }), {
                headers: { "Content-Type": "application/json" },
            }),
        );
        render(<ChatPage />);

        await ask("What is the status of the dev-health-ops project?");

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(body.expectedKinds).toEqual(["project"]);
    });

    it("omits expectedKinds when the question names no literal kind noun", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ result: answered }), {
                headers: { "Content-Type": "application/json" },
            }),
        );
        render(<ChatPage />);

        await ask("Is Atlas on track?");

        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(body).not.toHaveProperty("expectedKinds");
    });

    /**
     * A re-ask resends the RESULT's own `question` field unchanged (see
     * "re-asks with the chosen receipt..." above, which pins
     * `secondCallBody.question` to `clarification.question` — NOT the text
     * originally typed). So the hint on the re-ask is derived from THAT
     * text, independently of the first request's — proving `fireInvestigation`
     * re-derives it per request rather than caching the first ask's hint.
     * `clarification.question` ("Is Atlas on track?", the fixture's own
     * field) carries no literal kind noun, so the re-ask correctly omits it
     * even though the ORIGINAL typed question did carry one.
     */
    it("re-derives the hint per request rather than caching the first ask's", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Which team owns this project?");
        const user = userEvent.setup();
        const candidate = clarification.subject_resolution.candidates[0]!;
        await pickPopupOption(user, candidate.subject.label);
        await user.click(continueButton());

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const firstBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<
            string,
            unknown
        >;
        const secondBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(firstBody.expectedKinds).toEqual(["project", "team"]);
        expect(secondBody.question).toBe(clarification.question);
        expect(secondBody).not.toHaveProperty("expectedKinds");
    });
});

/**
 * Codex review findings on CHAOS-4343's fan-out (items 1/2), ported to the
 * popup. Each test reproduces the exact defect described, red-first against
 * the pre-fix shape, green with the fix.
 */
describe("fan-out correctness (codex review)", () => {
    /**
     * High: a settled sibling's own popup must stay non-interactive while
     * ANOTHER request from the SAME (or a later) batch is still in flight —
     * otherwise a tester could fire an overlapping action while state a
     * slower request still depends on is being reset out from under it.
     */
    it("keeps a settled sibling's popup options disabled while another fired request is still pending", async () => {
        let resolveFirst!: (response: Response) => void;
        const firstResponse = new Promise<Response>((resolve) => {
            resolveFirst = resolve;
        });
        const [first, second] = clarification.subject_resolution.candidates;
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            // The FIRST fired candidate never settles until the test says so.
            .mockImplementationOnce(() => firstResponse)
            // The SECOND fired candidate — the LATEST turn, so the only one
            // that CAN be live — settles quickly, with a result that itself
            // offers more chips to click.
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await pickPopupOption(user, first!.subject.label);
        await user.click(popupOptionButton(second!.subject.label));
        await user.click(continueButton());

        expect(fetchSpy).toHaveBeenCalledTimes(3);

        // The LATEST (second-fired) sibling settles into a fresh, live
        // popup; the first-fired sibling is still "Investigating…".
        const dialog = await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        expect(screen.getByText("Investigating…")).toBeInTheDocument();

        // The settled sibling's OWN popup option buttons must be disabled —
        // a sibling is still pending, so nothing on screen may be actioned.
        const optionButtons = within(dialog)
            .getAllByRole("button")
            .filter((button) => button.hasAttribute("aria-pressed"));
        expect(optionButtons.length).toBeGreaterThan(0);
        for (const button of optionButtons) {
            expect(button).toBeDisabled();
        }

        // Resolve the remaining sibling so the test leaves no dangling
        // pending state/act() warning behind it.
        resolveFirst(
            new Response(JSON.stringify({ result: answered }), {
                headers: { "Content-Type": "application/json" },
            }),
        );
        await waitFor(() => {
            expect(screen.queryByText("Investigating…")).toBeNull();
        });
    });

    /**
     * Medium: a frozen (superseded) turn renders no live candidate controls
     * at all (collapsed disclosure only) — the popup's own "confirm follows
     * selection" model has nothing left to snapshot once a newer turn takes
     * over, unlike the old inline echo this replaces.
     */
    it("a frozen turn shows the collapsed disclosure, not the popup or any live control", async () => {
        const candidate = clarification.subject_resolution.candidates[0]!;
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        await pickPopupOption(user, candidate.subject.label);
        await user.click(continueButton());

        expect(
            await screen.findAllByRole("article", { name: "Deterministic answer" }),
        ).toHaveLength(2);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByTestId("frozen-offers-disclosure")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: candidate.subject.label })).toBeNull();
    });

    /**
     * Medium: a candidate toggle's queued telemetry must not be silently
     * dropped just because the tester's NEXT action was a plain ask rather
     * than confirming that candidate pick.
     */
    it("does not drop a candidate toggle's queued telemetry when the next action is a plain ask", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: clarification }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Is Atlas on track?");
        const user = userEvent.setup();
        const candidate = clarification.subject_resolution.candidates[0]!;
        // Toggled, then NEVER confirmed — the tester instead types a fresh
        // question directly (the popup stays open but is simply ignored,
        // exactly the "typing a normal reply is always allowed" rule).
        await pickPopupOption(user, candidate.subject.label);
        await user.type(
            screen.getByLabelText("Ask a question"),
            "A completely different question?",
        );
        await user.click(screen.getByRole("button", { name: "Send" }));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.structureSelectionEvents).toEqual([
            { member: "subject_candidate", outcome: "submitted" },
        ]);
    });

    /**
     * Medium, codex review round 2: confirming ONE candidate axis used to
     * drop any pending-but-unconfirmed pick in the OTHER axis entirely. Both
     * axes present on the same result as two popup pages; select one
     * candidate on EACH, confirm only the LAST page — the earlier page's
     * pick must still fire its own request.
     */
    it("confirming the last page still fires the other page's earlier pending pick", async () => {
        const subjectCandidate = mixedCandidates.subject_resolution.candidates[0]!;
        const structureCandidateOption = mixedCandidates.structure_needs!.candidate_options![0]!;
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: mixedCandidates }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ result: answered }), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        render(<ChatPage />);

        await ask("Who owns this?");
        const user = userEvent.setup();
        // Page 1 (structure-candidate axis, not last): pick one, then
        // Continue WITHOUT firing yet — just advances to page 2.
        await pickPopupOption(user, structureCandidateOption.label);
        await user.click(continueButton());
        // Page 2 (subject-resolution axis, IS last): pick one, Continue
        // fires — carrying BOTH pages' picks.
        await screen.findByRole("dialog", { name: CLARIFICATION_PROMPT });
        await user.click(popupOptionButton(subjectCandidate.subject.label));
        await user.click(continueButton());

        expect(
            await screen.findAllByRole("article", { name: "Deterministic answer" }),
        ).toHaveLength(3);
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        const bodies = fetchSpy.mock.calls
            .slice(1)
            .map((call) => JSON.parse(call[1]!.body as string) as Record<string, unknown>);
        const subjectRequest = bodies.find(
            (body) =>
                Array.isArray(body.priorSubjectReceipts) && body.priorSubjectReceipts.length > 0,
        );
        const structureRequest = bodies.find(
            (body) =>
                Array.isArray(body.priorCandidateReceipts) &&
                body.priorCandidateReceipts.length > 0,
        );
        expect(subjectRequest?.priorSubjectReceipts).toEqual([
            { result_id: mixedCandidates.result_id, receipt_id: subjectCandidate.receipt_id },
        ]);
        expect(structureRequest?.priorCandidateReceipts).toEqual([
            {
                result_id: mixedCandidates.result_id,
                receipt_id: structureCandidateOption.receipt_id,
            },
        ]);
    });
});
