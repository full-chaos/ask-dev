import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/page";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const clarification = mockScenarios().find((scenario) => scenario.id === "clarification")!.result;
const answered = mockScenarios().find((scenario) => scenario.id === "complete")!.result;
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

describe("the clarification chip is live only on the most recent assistant turn", () => {
    it("offers the choice on a fresh clarification turn", async () => {
        respondWith({ result: clarification });
        render(<ChatPage />);

        await ask("Is Atlas on track?");

        expect(
            await screen.findByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Select / }).length).toBeGreaterThan(0);
    });

    /**
     * CHAOS-4343 items 1/2: selection leads (a toggle, not an immediate
     * fire), confirming follows. A single confirmed selection still
     * re-asks with exactly that candidate's receipt, unchanged from before.
     */
    it("re-asks with the chosen receipt and freezes the older turn's chip", async () => {
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
        await user.click(
            await screen.findByRole("button", {
                name: `Select ${candidate.subject.label}`,
            }),
        );
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

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

        // The now-superseded clarification turn can no longer be acted on:
        // its own candidate list renders, but read-only.
        expect(
            await screen.findByRole("region", { name: "Subject candidates" }),
        ).toBeInTheDocument();
        expect(screen.getByTestId("cannot-choose-here")).toBeInTheDocument();

        // Discriminating, not just "an article rendered": both turns share
        // the same `aria-label`, so `data-state` is what actually proves the
        // FIRST turn stayed a clarification and the SECOND turn is decisive.
        const turns = screen.getAllByRole("article", { name: "Deterministic answer" });
        expect(turns).toHaveLength(2);
        expect(turns[0]).toHaveAttribute("data-state", "clarification_required");
        expect(turns[1]).toHaveAttribute("data-state", answered.status);
    });

    /**
     * CHAOS-4343 item 2, the ticket's own acceptance scenario: N selected
     * candidates fire N INDEPENDENT turn-2 requests and land as N stacked
     * assistant turns, each with its own status — never one request
     * carrying several candidate receipts.
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
        await user.click(
            await screen.findByRole("button", { name: `Select ${first!.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: `Select ${second!.subject.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask about 2 selected candidates" }));

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
        await user.click(
            await screen.findByRole("button", { name: `Select ${first!.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: `Select ${second!.subject.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask about 2 selected candidates" }));

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
});

/**
 * CHAOS-4670: a panel selection's turn-2 request resends the SAME question
 * text as the turn it supersedes — it still runs for real on the wire
 * (asserted below via the second fetch call's body, unchanged from the
 * pre-existing tests above), but must not render as a second user bubble.
 * The compact record of what the re-run carried is the superseded turn's
 * own selection chips, already covered by the tests above.
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
        await user.click(
            await screen.findByRole("button", { name: `Select ${candidate.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

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
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

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
        await user.click(
            await screen.findByRole("button", { name: `Select ${first!.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: `Select ${second!.subject.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask about 2 selected candidates" }));

        await waitFor(() =>
            expect(screen.getAllByRole("article", { name: "Deterministic answer" })).toHaveLength(
                3,
            ),
        );
        expect(container.querySelectorAll(".chat__turn--user")).toHaveLength(1);
    });
});

describe("structure-needs chips (CHAOS-3927 P2, mounted as-is under a chat turn)", () => {
    it("renders the offers and sends the accumulated batch in ONE re-ask", async () => {
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
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

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

        // The superseded turn's panel is still visible but can no longer be
        // confirmed — inspection only, same as ClarificationPanel's own rule.
        expect(screen.getByTestId("cannot-confirm-structure-here")).toBeInTheDocument();

        // codex review round 1, finding 3: the frozen turn's own echo must
        // still show WHAT was submitted, not revert to "nothing selected"
        // the instant a newer turn takes over the shared selection hook.
        const frozenPanel = screen.getByRole("region", {
            name: "More structure would narrow this",
        });
        expect(within(frozenPanel).getByText("selected")).toBeInTheDocument();
    });

    /**
     * CHAOS-4343 items 1/2, live-verified against the kiac path (chris's own
     * flow: kind + window + N candidates land on the SAME `structure_needs`
     * disclosure): confirming N selected `candidate_options` entries fires N
     * independent turn-2 requests, each its own stacked panel — the SAME
     * multi-select discipline `chooseCandidates` holds for
     * `subject_resolution.candidates`, applied to this axis too.
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
        await user.click(await screen.findByRole("button", { name: `Select ${first!.label}` }));
        await user.click(screen.getByRole("button", { name: `Select ${second!.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

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
 * round 1 + round 2). Both orders in which a tester can act on a turn that
 * carries BOTH a subject-candidate clarification and a structure_needs
 * disclosure at once.
 */
describe("mixed receipt families (subject-candidate clarification + structure_needs together)", () => {
    it("renders both panels on the SAME turn", async () => {
        respondWith({ result: mixed });
        render(<ChatPage />);

        await ask("Who owns this?");

        expect(
            await screen.findByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("region", { name: "More structure would narrow this" }),
        ).toBeInTheDocument();
    });

    it("subject-first: picking a candidate carries an unconfirmed structure pick along, not just the receipt", async () => {
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
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        const candidate = mixed.subject_resolution.candidates[0]!;
        await user.click(screen.getByRole("button", { name: `Select ${candidate.subject.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

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

        // codex round 2, finding 1: a request-fields-only assertion here is
        // vacuous on its own — it can pass even if `submittedStructureBatch`
        // were dropped from the FROZEN turn's own echo (the wire body only
        // proves what THIS request sent, not what the superseded turn now
        // displays). Mirrors the existing structure-only test's own
        // "selected" badge check, and the mixed e2e's own round-2 fix.
        const frozenPanel = screen.getByRole("region", {
            name: "More structure would narrow this",
        });
        expect(within(frozenPanel).getByText("selected")).toBeInTheDocument();
    });

    /**
     * codex round 2, finding 1: the exact reverse-order path was untested.
     * `chooseStructure` cannot ALSO carry a subject receipt here — there is
     * no candidate selected in this test, so there is nothing accumulated
     * to carry (CHAOS-4343: `ClarificationPanel` now accumulates candidate
     * picks too, but only picks that were actually made). What this DOES
     * prove: confirming structure first sends only the structure family
     * (correctly — there is nothing else pending), and freezes the SAME
     * turn's subject chip too, exactly the existing "only the most recent
     * turn is live" rule already applies everywhere else.
     */
    it("structure-first: confirming structure sends only the structure family and freezes the turn's own subject chip too", async () => {
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
        await user.click(await screen.findByRole("button", { name: `Select ${option.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const secondCallBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string) as Record<
            string,
            unknown
        >;
        expect(secondCallBody.priorSubjectReceipts).toEqual([]);
        expect(secondCallBody.priorKindReceipts).toEqual([
            { result_id: mixed.result_id, receipt_id: option.receipt_id },
        ]);

        // The superseded turn's OWN subject chip is now read-only too — the
        // same freeze rule every other re-ask already applies, now proven
        // specifically for a turn that carried both families.
        expect(screen.getByTestId("cannot-choose-here")).toBeInTheDocument();
        expect(screen.getByTestId("cannot-confirm-structure-here")).toBeInTheDocument();
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
        await user.click(
            await screen.findByRole("button", { name: `Select ${candidate.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

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
 * Codex review findings on CHAOS-4343's fan-out (items 1/2). Each test
 * reproduces the exact defect described, red-first against the pre-fix
 * shape, green with the fix.
 */
describe("fan-out correctness (codex review)", () => {
    /**
     * High: a settled sibling's own panel must stay non-interactive while
     * ANOTHER request from the SAME (or a later) batch is still in flight —
     * otherwise a tester could fire an overlapping action while state a
     * slower request still depends on is being reset out from under it.
     */
    it("keeps a settled sibling panel's controls disabled while another fired request is still pending", async () => {
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
        await user.click(
            await screen.findByRole("button", { name: `Select ${first!.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: `Select ${second!.subject.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask about 2 selected candidates" }));

        expect(fetchSpy).toHaveBeenCalledTimes(3);

        // The LATEST (second-fired) sibling settles into a fresh, live
        // clarification; the first-fired sibling is still "Investigating…".
        await screen.findByRole("region", { name: "Which subject did you mean?" });
        expect(screen.getByText("Investigating…")).toBeInTheDocument();

        // The settled sibling's OWN offer buttons must be disabled — a
        // sibling is still pending, so nothing on screen may be actioned.
        const selectButtons = screen.getAllByRole("button", { name: /^Select / });
        expect(selectButtons.length).toBeGreaterThan(0);
        for (const button of selectButtons) {
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
     * Medium: a frozen (superseded) turn's own candidate panel must still
     * show what was actually picked — the same snapshot discipline
     * `submittedStructureBatch` already holds for kind/anchor/handle/window.
     */
    it("a frozen turn's candidate panel keeps its selected badges after a newer turn takes over", async () => {
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
        await user.click(
            await screen.findByRole("button", { name: `Select ${candidate.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

        expect(
            await screen.findAllByRole("article", { name: "Deterministic answer" }),
        ).toHaveLength(2);
        const frozenPanel = screen.getByRole("region", { name: "Subject candidates" });
        expect(within(frozenPanel).getByText("selected")).toBeInTheDocument();
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
        // question directly.
        await user.click(
            await screen.findByRole("button", { name: `Select ${candidate.subject.label}` }),
        );
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
     * axes present on the same result; select one candidate from EACH,
     * confirm only the subject-candidate one — the structure-candidate pick
     * must still fire its own request.
     */
    it("confirming one candidate axis still fires the other axis's pending pick", async () => {
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
        // Pick one structure candidate, WITHOUT confirming it...
        await user.click(
            await screen.findByRole("button", { name: `Select ${structureCandidateOption.label}` }),
        );
        // ...then pick and confirm a SUBJECT candidate instead.
        await user.click(
            screen.getByRole("button", { name: `Select ${subjectCandidate.subject.label}` }),
        );
        await user.click(screen.getByRole("button", { name: "Ask about 1 selected candidate" }));

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
