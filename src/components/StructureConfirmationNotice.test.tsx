import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StructureConfirmationNotice } from "@/components/StructureConfirmationNotice";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const applied = structureMockScenarios().find((s) => s.id === "structure-applied")!.result;
const vetoed = structureMockScenarios().find((s) => s.id === "structure-vetoed")!.result;

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
});
