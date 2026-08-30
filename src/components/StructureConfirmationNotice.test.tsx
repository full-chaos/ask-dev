import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const applied = structureMockScenarios().find((s) => s.id === "structure-applied")!.result;
const vetoed = structureMockScenarios().find((s) => s.id === "structure-vetoed")!.result;
// CHAOS-4364 (acr #306, 02c44254): a `carried` (not `receipt`/`explicit`)
// confirmed_structure source — the same-conversation window carry.
const flowLandscape = mockScenarios().find((s) => s.id === "flow-landscape")!.result;

describe("StructureConfirmationNotice", () => {
    it("renders nothing when the result carried no structure confirmation", () => {
        const { container } = render(<StructureConfirmationNotice entries={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("confirms every applied member, with a status (not alert) role", () => {
        render(<StructureConfirmationNotice entries={applied.confirmed_structure} />);

        const region = screen.getByRole("status", { name: "Structure confirmation" });
        expect(region).toHaveTextContent("Your selections were applied");
        for (const entry of applied.confirmed_structure!) {
            expect(region).toHaveTextContent(entry.applied_value);
        }
    });

    it("surfaces a veto as an alert, visibly, even though one member applied cleanly", () => {
        render(<StructureConfirmationNotice entries={vetoed.confirmed_structure} />);

        const region = screen.getByRole("alert", { name: "Structure confirmation" });
        expect(region).toHaveTextContent("Some selections were not applied");
        // The applied member is still shown, not hidden behind the veto.
        expect(region).toHaveTextContent("applied");
        expect(region).toHaveTextContent("was NOT applied");
    });

    it("names the §2.5 veto reason class rather than a generic failure", () => {
        render(<StructureConfirmationNotice entries={vetoed.confirmed_structure} />);

        expect(
            screen.getByText(/is no longer current \(superseded by a later confirmation\)/),
        ).toBeInTheDocument();
    });

    it("shows a carried (not receipt) structure member's source verbatim", () => {
        render(<StructureConfirmationNotice entries={flowLandscape.confirmed_structure} />);

        const region = screen.getByRole("status", { name: "Structure confirmation" });
        expect(region).toHaveTextContent("source carried");
        expect(region).toHaveTextContent("source receipt");
    });

    /**
     * CHAOS-4581: "receipts/applied selections collapse to a single chip row
     * once applied." The full per-entry record list is still reachable —
     * nothing above stopped asserting on it — but it now sits behind a
     * CLOSED disclosure by default, with a compact chip row as the visible
     * default state.
     */
    it("collapses to a compact chip row by default once every member applied cleanly", () => {
        render(<StructureConfirmationNotice entries={applied.confirmed_structure} />);

        const region = screen.getByRole("status", { name: "Structure confirmation" });
        const chipRow = within(region).getByTestId("structure-confirmation-chips");
        for (const entry of applied.confirmed_structure!) {
            expect(chipRow).toHaveTextContent(entry.applied_value);
        }
        const details = within(region).getByText("Selection details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
    });

    /** A veto needs attention — it is never collapsed. */
    it("does not collapse the record list behind a disclosure when a member was vetoed", () => {
        render(<StructureConfirmationNotice entries={vetoed.confirmed_structure} />);

        const region = screen.getByRole("alert", { name: "Structure confirmation" });
        expect(within(region).queryByText("Selection details")).toBeNull();
    });
});
