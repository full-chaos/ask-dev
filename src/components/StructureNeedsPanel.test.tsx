import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StructureNeedsPanel } from "@/components/StructureNeedsPanel";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const kindScenario = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
const anchorWindowScenario = structureMockScenarios().find(
    (s) => s.id === "structure-anchor-window",
)!.result;
const aggregateScenario = structureMockScenarios().find(
    (s) => s.id === "structure-aggregate-never-elicit",
)!.result;

describe("StructureNeedsPanel", () => {
    it("renders exactly the offers the result carries, in the result's own order", () => {
        render(
            <StructureNeedsPanel
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

    it("never offers anchor/handle for an aggregate-classed disclosure (NEVER-ELICIT, §1.3)", () => {
        render(
            <StructureNeedsPanel
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
            <StructureNeedsPanel
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
            <StructureNeedsPanel
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
        expect(onConfirm).toHaveBeenCalledWith({
            subject_anchor: {
                result_id: anchorWindowScenario.result_id,
                receipt_id: anchor.receipt_id,
            },
            window: { result_id: anchorWindowScenario.result_id, receipt_id: window.receipt_id },
        });
    });

    it("replaces a member's selection rather than accumulating two receipts for it", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <StructureNeedsPanel
                onConfirm={onConfirm}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        const [first, second] = kindScenario.structure_needs!.kind_options!;
        await user.click(screen.getByRole("button", { name: `Select ${first!.label}` }));
        await user.click(screen.getByRole("button", { name: `Select ${second!.label}` }));
        await user.click(screen.getByRole("button", { name: "Ask again with these selections" }));

        expect(onConfirm).toHaveBeenCalledWith({
            expected_kind: { result_id: kindScenario.result_id, receipt_id: second!.receipt_id },
        });
    });

    it("disables the confirm action until at least one selection is made", () => {
        render(
            <StructureNeedsPanel
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Ask again with these selections" }),
        ).toBeDisabled();
    });

    it("says it cannot re-ask when no onConfirm is supplied, and offers no confirm action", () => {
        render(
            <StructureNeedsPanel
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );

        expect(screen.getByTestId("cannot-confirm-structure-here")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Ask again with these selections" }),
        ).toBeNull();
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
            <StructureNeedsPanel
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
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const user = userEvent.setup();
        const wrongNamespaceNeeds = {
            missing: ["expected_kind"] as const,
            kind_options: [
                {
                    ...kindScenario.structure_needs!.kind_options![0]!,
                    receipt_id: "ancr_wrong_namespace_0001",
                },
            ],
        };
        render(
            <StructureNeedsPanel
                onConfirm={onConfirm}
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
        // codex round 2: a rejected click must not look like nothing
        // happened — it is surfaced as a visible alert, not left as a
        // silently-disabled confirm button with no explanation.
        expect(screen.getByRole("alert")).toHaveTextContent("This is a Workbench bug");
        expect(
            screen.getByRole("button", { name: "Ask again with these selections" }),
        ).toBeDisabled();
        consoleError.mockRestore();
    });

    /**
     * codex round 1, finding 2: without a `key`, React reuses this
     * component's local state across a prop change, so a re-ask that
     * returns a NEW result could carry a PRIOR result's selection forward.
     * page.tsx/DeterministicAnswerView.tsx now key this component by
     * `result_id` (React's own prescribed fix); this proves the component
     * itself starts clean on remount, which is what that key relies on.
     */
    it("starts with no selection on a fresh mount, even for a different result", async () => {
        const user = userEvent.setup();
        const { unmount } = render(
            <StructureNeedsPanel
                onConfirm={vi.fn()}
                resultId={kindScenario.result_id}
                structureNeeds={kindScenario.structure_needs!}
            />,
        );
        const option = kindScenario.structure_needs!.kind_options![0]!;
        await user.click(screen.getByRole("button", { name: `Select ${option.label}` }));
        expect(
            screen.getByRole("button", { name: `Unselect ${option.label}` }),
        ).toBeInTheDocument();
        unmount();

        const onConfirm = vi.fn();
        render(
            <StructureNeedsPanel
                onConfirm={onConfirm}
                resultId={anchorWindowScenario.result_id}
                structureNeeds={anchorWindowScenario.structure_needs!}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Ask again with these selections" }),
        ).toBeDisabled();
    });
});
