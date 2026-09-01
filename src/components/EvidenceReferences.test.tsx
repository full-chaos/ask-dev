import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceReferences } from "@/components/EvidenceReferences";

/**
 * CHAOS-4690/CHAOS-4691 acceptance: "the two anchor questions' answers
 * contain no ... acr:v1:* strings outside collapsed Details." The label on
 * the lead surface is now the ENGINE's own `evidence_ref_labels` entry
 * (`ContextFabricEvidenceRefLabel`), never a consumer-side lookup table —
 * `src/lib/vocab-mapping.ts` (the module that used to compute this label
 * itself, CHAOS-4673) is deleted entirely (chris's strike-three ruling).
 */
describe("EvidenceReferences: CHAOS-4690/4691 raw acr:v1 ids stay collapsed, label is engine-provided", () => {
    it("shows the engine's own label on the lead surface, not the raw acr:v1:* id", () => {
        render(
            <EvidenceReferences
                evidenceRefIds={["acr:v1:team:gh:ops-team"]}
                evidenceRefLabels={{ "acr:v1:team:gh:ops-team": "Team: gh:ops-team" }}
            />,
        );

        // The raw id is not on the lead surface at all -- the Details body
        // (collapsed by default, jsdom does not render <details> children as
        // hidden text-absent, so this checks the DOM position instead).
        const raw = screen.getByText("acr:v1:team:gh:ops-team");
        const details = raw.closest("details");
        expect(details).not.toBeNull();
        expect(details).toHaveAttribute("data-testid", "evidence-ref-raw-ids");
        expect(details).not.toHaveAttribute("open");

        expect(screen.getByText("Team: gh:ops-team")).toBeInTheDocument();
        // The engine label lives OUTSIDE the collapsed Details.
        expect(screen.getByText("Team: gh:ops-team").closest("details")).toBeNull();
    });

    it("falls back to the generic 'Evidence' floor for an id absent from the label map -- raw id still collapsed", () => {
        render(
            <EvidenceReferences
                evidenceRefIds={["evidence_release_acceptance"]}
                evidenceRefLabels={{}}
            />,
        );

        expect(screen.getByText("Evidence")).toBeInTheDocument();
        const raw = screen.getByText("evidence_release_acceptance");
        expect(raw.closest("details")).not.toBeNull();
    });

    /**
     * NAMED EXCEPTION (CHAOS-4691 pin delta item 6): an immutable result
     * stored before CHAOS-4690 carries no `evidence_ref_labels` map at all
     * (not an empty one) -- `undefined`, not `{}`. Every id must still fall
     * through to the SAME generic floor, never a client-side reconstruction
     * of what the id might mean.
     */
    it("falls back to the generic floor for every id when the label map itself is undefined (legacy stored result)", () => {
        render(
            <EvidenceReferences
                evidenceRefIds={["acr:v1:pull-request:482"]}
                evidenceRefLabels={undefined}
            />,
        );

        expect(screen.getByText("Evidence")).toBeInTheDocument();
        expect(screen.queryByText("Pull request: 482")).toBeNull();
        expect(screen.getByText("acr:v1:pull-request:482")).toBeInTheDocument();
    });

    it("renders nothing for an empty or undefined id list", () => {
        const { container: empty } = render(
            <EvidenceReferences evidenceRefIds={[]} evidenceRefLabels={undefined} />,
        );
        expect(empty.firstChild).toBeNull();
        const { container: undef } = render(
            <EvidenceReferences evidenceRefIds={undefined} evidenceRefLabels={undefined} />,
        );
        expect(undef.firstChild).toBeNull();
    });
});
