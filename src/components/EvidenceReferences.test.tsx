import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceReferences } from "@/components/EvidenceReferences";

/**
 * CHAOS-4673 acceptance: "the two anchor questions' answers contain no ...
 * acr:v1:* strings outside collapsed Details."
 */
describe("EvidenceReferences: CHAOS-4673 raw acr:v1 ids stay collapsed", () => {
    it("shows a human label on the lead surface, not the raw acr:v1:* id", () => {
        render(<EvidenceReferences evidenceRefIds={["acr:v1:team:gh:ops-team"]} />);

        // The raw id is not on the lead surface at all -- the Details body
        // (collapsed by default, jsdom does not render <details> children as
        // hidden text-absent, so this checks the DOM position instead).
        const raw = screen.getByText("acr:v1:team:gh:ops-team");
        const details = raw.closest("details");
        expect(details).not.toBeNull();
        expect(details).toHaveAttribute("data-testid", "evidence-ref-raw-ids");
        expect(details).not.toHaveAttribute("open");

        expect(screen.getByText("Team: gh:ops-team")).toBeInTheDocument();
        // The human label lives OUTSIDE the collapsed Details.
        expect(screen.getByText("Team: gh:ops-team").closest("details")).toBeNull();
    });

    it("fails readable on an unrecognized evidence id -- generic label, raw id still collapsed", () => {
        render(<EvidenceReferences evidenceRefIds={["evidence_release_acceptance"]} />);

        expect(screen.getByText("Evidence")).toBeInTheDocument();
        const raw = screen.getByText("evidence_release_acceptance");
        expect(raw.closest("details")).not.toBeNull();
    });

    it("renders nothing for an empty or undefined id list", () => {
        const { container: empty } = render(<EvidenceReferences evidenceRefIds={[]} />);
        expect(empty.firstChild).toBeNull();
        const { container: undef } = render(<EvidenceReferences evidenceRefIds={undefined} />);
        expect(undef.firstChild).toBeNull();
    });
});
