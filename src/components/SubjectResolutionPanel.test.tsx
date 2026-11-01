import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import type { SubjectResolution } from "@/lib/contracts";

const BASE_RESOLUTION: SubjectResolution = {
    candidates: [],
    committed: [{ kind: "repository", canonical_id: "repository:repo_atlas", label: "atlas" }],
};

describe("SubjectResolutionPanel words", () => {
    it("words a candidate's state and kind, with no canonical id", () => {
        const resolution: SubjectResolution = {
            committed: [{ kind: "work_item", canonical_id: "work_item:1", label: "One" }],
            candidates: [
                {
                    subject: { kind: "pull_request", canonical_id: "pull_request:2", label: "Two" },
                    state: "committed",
                    confidence: 0.5,
                    match_reasons: [],
                    evidence_ref_ids: [],
                    receipt_id: "subr_0002",
                },
            ],
        } as unknown as SubjectResolution;

        const { container } = render(
            <SubjectResolutionPanel evidenceRefLabels={undefined} resolution={resolution} />,
        );

        expect(screen.getByText("Settled on: One (work item)")).toBeInTheDocument();
        expect(screen.getByText("Settled on")).toBeInTheDocument();
        expect(container).toHaveTextContent("pull request · confidence 50%");
        expect(container.textContent).not.toContain("pull_request:2");
    });
});

describe("SubjectResolutionPanel", () => {
    it("renders no prior-receipt section when the result carries none", () => {
        render(
            <SubjectResolutionPanel evidenceRefLabels={undefined} resolution={BASE_RESOLUTION} />,
        );

        expect(screen.queryByRole("heading", { name: "Earlier subject choices" })).toBeNull();
    });

    /**
     * CHAOS-3478/CHAOS-3813 (acr PR #265, e946ad90): a prior-turn subject
     * receipt used to be a SILENT drop — `@/lib/clarification.ts`'s own
     * header documents that acr gave the caller nothing to detect it with
     * beyond a server-side counter. This is the disclosure that closes that
     * gap: every receipt the caller sent gets a wire-visible entry here,
     * applied or skipped, with the skip reason named.
     */
    it("discloses every prior-turn subject receipt the result carries, applied and skipped alike", () => {
        const resolution: SubjectResolution = {
            ...BASE_RESOLUTION,
            prior_subject_receipt_dispositions: [
                {
                    prior_result_id: "result_prior_0001",
                    receipt_id: "subr_0001",
                    disposition: "applied",
                },
                {
                    prior_result_id: "result_prior_0002",
                    receipt_id: "subr_0002",
                    disposition: "skipped_stale_graph_epoch",
                },
            ],
        };

        const { container } = render(
            <SubjectResolutionPanel evidenceRefLabels={undefined} resolution={resolution} />,
        );

        expect(
            screen.getByRole("heading", { name: "Earlier subject choices" }),
        ).toBeInTheDocument();
        expect(container.querySelector('[data-receipt-id="subr_0001"]')).toHaveTextContent(
            "Choice 1: Applied",
        );
        // The state in words, not just a badge color.
        expect(container.querySelector('[data-receipt-id="subr_0002"]')).toHaveTextContent(
            "Choice 2: Not applied: the data has changed since",
        );
        // A receipt or a result id is never read by a user.
        expect(container.textContent).not.toMatch(/subr_|result_prior/u);
    });
});

/**
 * CHAOS-4669 defect 4 (standing empty-states rule): "SUBJECTS — Nothing
 * committed. No candidates were proposed." is a contentless meta panel,
 * not an empty state worth showing. chris's own UX notes named this exact
 * panel.
 */
describe("SubjectResolutionPanel — CHAOS-4669 contentless suppression", () => {
    it("renders nothing when there is no prompt, no committed subjects, no candidates, and no prior-receipt disclosure", () => {
        const emptyResolution: SubjectResolution = { candidates: [], committed: [] };
        const { container } = render(
            <SubjectResolutionPanel evidenceRefLabels={undefined} resolution={emptyResolution} />,
        );
        expect(container.firstChild).toBeNull();
        expect(screen.queryByRole("heading", { name: "Subjects" })).toBeNull();
    });

    it("still renders when committed subjects exist, even with no candidates (BASE_RESOLUTION's own shape)", () => {
        render(
            <SubjectResolutionPanel evidenceRefLabels={undefined} resolution={BASE_RESOLUTION} />,
        );
        expect(screen.getByRole("heading", { name: "Subjects" })).toBeInTheDocument();
        expect(screen.getByText(/Settled on: atlas/)).toBeInTheDocument();
    });

    it("still renders when the ONLY content is a prior-receipt disclosure", () => {
        const resolution: SubjectResolution = {
            candidates: [],
            committed: [],
            prior_subject_receipt_dispositions: [
                {
                    prior_result_id: "result_prior_0001",
                    receipt_id: "subr_0001",
                    disposition: "applied",
                },
            ],
        };
        render(<SubjectResolutionPanel evidenceRefLabels={undefined} resolution={resolution} />);
        expect(screen.getByRole("heading", { name: "Subjects" })).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: "Earlier subject choices" }),
        ).toBeInTheDocument();
    });

    it("still renders when the ONLY content is a clarification prompt", () => {
        const resolution: SubjectResolution = {
            candidates: [],
            committed: [],
            clarification_prompt: "Which repository did you mean?",
        };
        render(<SubjectResolutionPanel evidenceRefLabels={undefined} resolution={resolution} />);
        expect(screen.getByRole("heading", { name: "Subjects" })).toBeInTheDocument();
        expect(screen.getByText("Which repository did you mean?")).toBeInTheDocument();
    });

    it("still renders when there are candidates but no committed subjects", () => {
        const resolution: SubjectResolution = {
            committed: [],
            candidates: [
                {
                    receipt_id: "subr_cand_0001",
                    subject: { kind: "project", canonical_id: "project_atlas", label: "Atlas" },
                    state: "proposed",
                    confidence: 0.5,
                    match_reasons: ["name similarity"],
                    evidence_ref_ids: [],
                },
            ],
        };
        render(<SubjectResolutionPanel evidenceRefLabels={undefined} resolution={resolution} />);
        expect(screen.getByRole("heading", { name: "Subjects" })).toBeInTheDocument();
        expect(screen.getByText("Atlas")).toBeInTheDocument();
    });
});
