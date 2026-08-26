import { useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import {
    EMPTY_CANDIDATE_SELECTION_BATCH,
    toggleCandidateSelection,
    type CandidateSelectionBatch,
} from "@/lib/candidate-selections";
import type { BoundStructureReceipt, StructureNeedKind, StructureNeeds } from "@/lib/contracts";
import {
    EMPTY_STRUCTURE_SELECTION_BATCH,
    toggleStructureOffer,
    type StructureSelectionBatch,
} from "@/lib/structure-selections";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const kindScenario = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
const anchorWindowScenario = structureMockScenarios().find(
    (s) => s.id === "structure-anchor-window",
)!.result;
const aggregateScenario = structureMockScenarios().find(
    (s) => s.id === "structure-aggregate-never-elicit",
)!.result;
const candidateScenario = structureMockScenarios().find(
    (s) => s.id === "structure-candidate",
)!.result;
const kindPhrasingScenario = structureMockScenarios().find(
    (s) => s.id === "structure-kind-phrasing",
)!.result;
const anchorHandleCandidatePhrasingScenario = structureMockScenarios().find(
    (s) => s.id === "structure-anchor-handle-candidate-phrasing",
)!.result;

/**
 * `batch` is a CONTROLLED prop (codex round 3: lifted so a selection
 * survives a switch between the two places this panel is rendered — see
 * StructureNeedsPanel.tsx's own header comment). This harness plays the
 * role page.tsx actually plays: it owns the batch and the toggle reducer,
 * and — when `twoInstances` is set — renders TWO separate panel instances
 * sharing that SAME state, scoped by `data-testid` so tests can address
 * either one, proving the cross-view sharing this fix exists for.
 */
function Harness({
    structureNeeds,
    resultId,
    onConfirm,
    onReject = () => {},
    onToggle: onToggleSpy,
    twoInstances = false,
}: {
    readonly structureNeeds: StructureNeeds;
    readonly resultId: string;
    readonly onConfirm?:
        | ((
              batch: StructureSelectionBatch,
              candidateReceipts: readonly BoundStructureReceipt[],
          ) => void)
        | undefined;
    readonly onReject?: ((member: StructureNeedKind) => void) | undefined;
    /** Observes every accepted toggle in addition to the harness's own batch update. */
    readonly onToggle?:
        ((member: StructureNeedKind, receipt: BoundStructureReceipt) => void) | undefined;
    readonly twoInstances?: boolean;
}) {
    const [batch, setBatch] = useState<StructureSelectionBatch>(EMPTY_STRUCTURE_SELECTION_BATCH);
    const [candidateBatch, setCandidateBatch] = useState<CandidateSelectionBatch>(
        EMPTY_CANDIDATE_SELECTION_BATCH,
    );
    function onToggle(member: StructureNeedKind, receipt: BoundStructureReceipt) {
        onToggleSpy?.(member, receipt);
        setBatch((current) => toggleStructureOffer(current, member, receipt));
    }
    function onToggleCandidate(receiptId: string) {
        setCandidateBatch((current) => toggleCandidateSelection(current, receiptId));
    }
    const panel = (
        <StructureNeedsPanel
            batch={batch}
            onConfirm={onConfirm}
            onReject={onReject}
            onToggle={onToggle}
            onToggleCandidate={onToggleCandidate}
            resultId={resultId}
            selectedCandidateReceiptIds={candidateBatch}
            structureNeeds={structureNeeds}
        />
    );
    if (!twoInstances) return panel;
    return (
        <>
            <div data-testid="instance-a">{panel}</div>
            <div data-testid="instance-b">
                <StructureNeedsPanel
                    batch={batch}
                    onConfirm={onConfirm}
                    onReject={onReject}
                    onToggle={onToggle}
                    onToggleCandidate={onToggleCandidate}
                    resultId={resultId}
                    selectedCandidateReceiptIds={candidateBatch}
                    structureNeeds={structureNeeds}
                />
            </div>
        </>
    );
}

describe("StructureNeedsPanel", () => {
    it("renders exactly the offers the result carries, in the result's own order", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        const options = kindScenario.structure_needs!.kind_options!;
        const buttons = screen
            .getAllByRole("button", { name: /^Select / })
            .map((button) => button.textContent);
        expect(buttons).toEqual(options.map((option) => `Select ${option.label}`));
        for (const option of options) {
            expect(screen.getByText(option.receipt_id)).toBeInTheDocument();
        }
    });

    /**
     * CHAOS-4171: the 5th offer axis, appended after kind/anchor/handle/window.
     * CHAOS-4343 items 1/2: candidate is the ONE multi-select member — a
     * single pick still produces a one-entry `candidateReceipts` array,
     * SEPARATE from `batch` (which never carries `subject_candidate` any
     * more; see the multi-select test below for N picks).
     */
    it("renders candidate offers (CHAOS-4012) and submits the candr_ receipt on confirm", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={candidateScenario.result_id}
                structureNeeds={candidateScenario.structure_needs!}
            />,
        );

        const options = candidateScenario.structure_needs!.candidate_options!;
        const buttons = screen
            .getAllByRole("button", { name: /^Select / })
            .map((button) => button.textContent);
        expect(buttons).toEqual(options.map((option) => `Select ${option.label}`));
        for (const option of options) {
            expect(screen.getByText(option.receipt_id)).toBeInTheDocument();
        }

        const first = options[0]!;
        await user.click(screen.getByRole("button", { name: `Select ${first.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledWith({}, [
            { result_id: candidateScenario.result_id, receipt_id: first.receipt_id },
        ]);
    });

    /**
     * CHAOS-4343 item 2: several distinct candidates selected at once
     * produce several entries, in ACR's OWN order — never the click order —
     * and `batch` stays empty (candidate never enters it).
     */
    it("multi-select: several candidate picks all ride the SAME confirm, in ACR's order", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={candidateScenario.result_id}
                structureNeeds={candidateScenario.structure_needs!}
            />,
        );

        const [first, second] = candidateScenario.structure_needs!.candidate_options!;
        // Selected out of order (second before first) — the confirmed
        // payload must still come back first-then-second.
        await user.click(screen.getByRole("button", { name: `Select ${second!.label}` }));
        await user.click(screen.getByRole("button", { name: `Select ${first!.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledWith({}, [
            { result_id: candidateScenario.result_id, receipt_id: first!.receipt_id },
            { result_id: candidateScenario.result_id, receipt_id: second!.receipt_id },
        ]);
    });

    /**
     * CHAOS-4171 PR3 (acr PR2, #263): `phrasing` is presentation-only wording
     * for an offer the model generated; the VALUE stays structural. This
     * proves both halves of "offer values stay structural, phrasing is
     * presentation-only" (chris 2026-08-24 10:04) in one scenario: the
     * phrased option displays the model's wording as its button/title text
     * while the structural `label` stays visible for inspection (same rule
     * `@/lib/presentation.ts` holds for tone maps — the raw term is never
     * hidden behind generated wording); the unphrased sibling in the SAME
     * list falls open to its structural `label`, exactly as it did before
     * this pin brought `phrasing` in at all.
     */
    it("renders model phrasing when acr supplied it, and falls open to the structural label when it did not", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={kindPhrasingScenario.result_id}
                structureNeeds={kindPhrasingScenario.structure_needs!}
            />,
        );

        const [phrased, unphrased] = kindPhrasingScenario.structure_needs!.kind_options!;
        expect(phrased!.phrasing).toBeDefined();
        expect(unphrased!.phrasing).toBeUndefined();

        // The phrased option: displayed text is the phrasing, not the label...
        expect(
            screen.getByRole("button", { name: `Select ${phrased!.phrasing}` }),
        ).toBeInTheDocument();
        // ...but the structural label is still shown, for inspection.
        expect(screen.getByText(`structural: ${phrased!.label}`)).toBeInTheDocument();
        // The unphrased sibling: no change from the pre-phrasing behavior.
        expect(
            screen.getByRole("button", { name: `Select ${unphrased!.label}` }),
        ).toBeInTheDocument();
        expect(screen.queryByText(`structural: ${unphrased!.label}`)).toBeNull();
    });

    /**
     * The phrasing text is cosmetic only — selecting via the phrased
     * button must still submit the STRUCTURAL receipt, unchanged.
     */
    it("submits the structural receipt_id for a phrased selection, not the phrasing text", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={kindPhrasingScenario.result_id}
                structureNeeds={kindPhrasingScenario.structure_needs!}
            />,
        );

        const phrased = kindPhrasingScenario.structure_needs!.kind_options![0]!;
        await user.click(screen.getByRole("button", { name: `Select ${phrased.phrasing}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledWith(
            {
                expected_kind: {
                    result_id: kindPhrasingScenario.result_id,
                    receipt_id: phrased.receipt_id,
                },
            },
            [],
        );
    });

    /**
     * codex finding (chaos4171pr3-codex-r1): the phrasing test above only
     * exercised `KindOption` — removing `phrasing={option.phrasing}` from
     * the Anchor/Handle/Candidate sections would have left every test
     * green. One phrased offer per remaining axis closes that.
     */
    it("renders model phrasing on anchor, handle, and candidate offers too", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={anchorHandleCandidatePhrasingScenario.result_id}
                structureNeeds={anchorHandleCandidatePhrasingScenario.structure_needs!}
            />,
        );

        const needs = anchorHandleCandidatePhrasingScenario.structure_needs!;
        const anchor = needs.anchor_options![0]!;
        const handle = needs.handle_options![0]!;
        const candidate = needs.candidate_options![0]!;

        for (const option of [anchor, handle, candidate]) {
            expect(option.phrasing).toBeDefined();
            expect(
                screen.getByRole("button", { name: `Select ${option.phrasing}` }),
            ).toBeInTheDocument();
            expect(screen.getByText(`structural: ${option.label}`)).toBeInTheDocument();
        }
    });

    it("never offers anchor/handle for an aggregate-classed disclosure (NEVER-ELICIT, §1.3)", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={aggregateScenario.result_id}
                structureNeeds={aggregateScenario.structure_needs!}
            />,
        );

        expect(
            screen.queryByRole("heading", { name: "Which repository, project, or team?" }),
        ).toBeNull();
        expect(screen.queryByRole("heading", { name: "Which specific item?" })).toBeNull();
        expect(screen.getByRole("heading", { name: "Over what period?" })).toBeInTheDocument();
    });

    it("does not fire a confirmation before the tester confirms (accumulate, not per-pick)", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        const first = kindScenario.structure_needs!.kind_options![0]!;
        await user.click(screen.getByRole("button", { name: `Select ${first.label}` }));

        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("accumulates selections across members and sends them ALL in one confirm (accumulate-and-re-ask-ONCE, §2.2)", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={anchorWindowScenario.result_id}
                structureNeeds={anchorWindowScenario.structure_needs!}
            />,
        );

        const anchor = anchorWindowScenario.structure_needs!.anchor_options![0]!;
        const window = anchorWindowScenario.structure_needs!.window_options![0]!;
        await user.click(screen.getByRole("button", { name: `Select ${anchor.label}` }));
        await user.click(screen.getByRole("button", { name: `Select ${window.label}` }));

        expect(onConfirm).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith(
            {
                subject_anchor: {
                    result_id: anchorWindowScenario.result_id,
                    receipt_id: anchor.receipt_id,
                },
                window: {
                    result_id: anchorWindowScenario.result_id,
                    receipt_id: window.receipt_id,
                },
            },
            [],
        );
    });

    it("replaces a member's selection rather than accumulating two receipts for it", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        const [first, second] = kindScenario.structure_needs!.kind_options!;
        await user.click(screen.getByRole("button", { name: `Select ${first!.label}` }));
        await user.click(screen.getByRole("button", { name: `Select ${second!.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledWith(
            {
                expected_kind: {
                    result_id: kindScenario.result_id,
                    receipt_id: second!.receipt_id,
                },
            },
            [],
        );
    });

    it("disables the confirm action until at least one selection is made", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Ask again with these selections" }),
        ).toBeDisabled();
    });

    it("says it cannot re-ask when no onConfirm is supplied, and offers no select/confirm action", () => {
        render(
            <Harness
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        expect(screen.getByTestId("cannot-confirm-structure-here")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Ask again with these selections" }),
        ).toBeNull();
        // Read-only mirrors ClarificationPanel's own CandidateRecord: no
        // action affordance at all when the surface cannot act on it.
        expect(screen.queryByRole("button", { name: /^Select / })).toBeNull();
    });

    /**
     * codex round 1: accepted_grammars is the "supply it explicitly next
     * turn" affordance the design brief scopes to the MCP surface (§2.3,
     * "agents can't click a panel"), never to the panel (§2.2's own list of
     * what to render names only typed, tappable offers). Rendering it here
     * read as inviting free-text discriminator input on a surface whose
     * whole contract is receipts-only — out of P2's scope, not just
     * unimplemented.
     */
    it("never renders a free-text-style 'supply it directly' affordance (receipts only, §2.2)", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        expect(screen.queryByRole("heading", { name: "Accepted for direct supply" })).toBeNull();
        expect(screen.queryByText(/expected_kind_enum/)).toBeNull();
    });

    /**
     * codex round 1, finding 3: the namespace check was documented as
     * "checked eagerly" but nothing actually called it. A mismatched
     * namespace should never be constructible from this component's own
     * per-member offer lists, so this exercises the guard directly via a
     * hand-built offer shaped like a wiring bug (an anchor-namespaced
     * receipt under the kind member) — the guard, not a realistic scenario.
     */
    it("rejects a selection whose receipt is outside the member's own namespace", async () => {
        const onConfirm = vi.fn();
        const onReject = vi.fn();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const user = userEvent.setup();
        const wrongNamespaceNeeds: StructureNeeds = {
            missing: ["expected_kind"],
            kind_options: [
                {
                    ...kindScenario.structure_needs!.kind_options![0]!,
                    receipt_id: "ancr_wrong_namespace_0001",
                },
            ],
        };
        render(
            <Harness
                onConfirm={onConfirm}
                onReject={onReject}
                resultId={kindScenario.result_id}
                structureNeeds={wrongNamespaceNeeds}
            />,
        );

        await user.click(
            screen.getByRole("button", {
                name: `Select ${kindScenario.structure_needs!.kind_options![0]!.label}`,
            }),
        );

        expect(consoleError).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
        // codex round 2: a rejected click must not look like nothing
        // happened — it is surfaced as a visible alert, not left as a
        // silently-disabled confirm button with no explanation.
        expect(screen.getByRole("alert")).toHaveTextContent("This is a Workbench bug");
        expect(
            screen.getByRole("button", { name: "Ask again with these selections" }),
        ).toBeDisabled();
        // CHAOS-4171 standing order: the rejection is telemetered too, not
        // just the successful path — but not emitted HERE (team-lead
        // ruling: a browser console.info is collected nowhere in prod).
        // `onReject` is what the caller (`useStructureSelections`) queues
        // for the next submit to carry and the route to emit; see
        // `use-structure-selections.test.ts` and `route.test.ts` for the
        // rest of that chain.
        expect(onReject).toHaveBeenCalledWith("expected_kind");
        consoleError.mockRestore();
    });

    /**
     * CHAOS-4171 standing order: telemetry baked into new logic, same PR.
     * The panel's own job is only to call `onToggle` on a namespace-valid
     * pick — `useStructureSelections.toggle` (not this component) is what
     * records the "submitted" outcome, and the route is what emits it
     * (see `use-structure-selections.test.ts` / `route.test.ts`).
     */
    it("calls onToggle, not onReject, on a real (namespace-valid) selection", async () => {
        const onToggle = vi.fn();
        const onReject = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={vi.fn()}
                onReject={onReject}
                onToggle={onToggle}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        const first = kindScenario.structure_needs!.kind_options![0]!;
        await user.click(screen.getByRole("button", { name: `Select ${first.label}` }));

        expect(onToggle).toHaveBeenCalledWith(
            "expected_kind",
            expect.objectContaining({ receipt_id: first.receipt_id }),
        );
        expect(onReject).not.toHaveBeenCalled();
    });

    /**
     * codex round 3: `StructureNeedsPanel` is rendered as TWO separate
     * component instances in the real app — one in the raw inspector view,
     * one inside `DeterministicAnswerView` — and switching between them
     * used to lose an in-progress selection, because the batch lived in
     * each instance's own local state. `batch`/`onToggle` are now
     * controlled props the caller shares across both instances; this
     * harness plays that caller's role directly, proving a pick made in
     * instance A is immediately visible — and confirmable — from instance B.
     */
    it("shares selections across two panel instances given the same batch (cross-view survival)", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <Harness
                onConfirm={onConfirm}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
                twoInstances
            />,
        );

        const option = kindScenario.structure_needs!.kind_options![0]!;
        const instanceA = within(screen.getByTestId("instance-a"));
        const instanceB = within(screen.getByTestId("instance-b"));

        await user.click(instanceA.getByRole("button", { name: `Select ${option.label}` }));

        // The pick made in A is visible in B without any re-selection.
        expect(
            instanceB.getByRole("button", { name: `Unselect ${option.label}` }),
        ).toBeInTheDocument();

        // And B's OWN confirm action carries it — proving the state, not
        // just the label, is shared.
        await user.click(
            instanceB.getByRole("button", { name: "Ask again with these selections" }),
        );

        expect(onConfirm).toHaveBeenCalledWith(
            { expected_kind: { result_id: kindScenario.result_id, receipt_id: option.receipt_id } },
            [],
        );
    });

    /**
     * Portability (team-lead): a future conversational surface may mount
     * this panel more than once at a time (e.g. one per chat-message
     * turn), so `aria-labelledby` must not collide across instances — two
     * hardcoded ids sharing a DOM tree silently break the association
     * (the browser resolves `aria-labelledby` to the FIRST matching id).
     * `useId()` fixes this; this proves it directly rather than relying on
     * the cross-view test above to catch it incidentally.
     */
    it("gives two simultaneous instances distinct heading ids (no aria-labelledby collision)", () => {
        render(
            <Harness
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
                twoInstances
            />,
        );

        const [headingA, headingB] = screen.getAllByRole("heading", {
            name: "More structure would narrow this",
        });
        expect(headingA!.id).not.toBe("");
        expect(headingA!.id).not.toBe(headingB!.id);
    });
});
