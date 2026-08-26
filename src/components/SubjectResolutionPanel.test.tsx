import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubjectResolutionPanel } from "@/components/SubjectResolutionPanel";
import type { SubjectResolution } from "@/lib/contracts";

const BASE_RESOLUTION: SubjectResolution = {
    candidates: [],
    committed: [{ kind: "repository", canonical_id: "repository:repo_atlas", label: "atlas" }],
};

describe("SubjectResolutionPanel", () => {
    it("renders no prior-receipt section when the result carries none", () => {
        render(<SubjectResolutionPanel resolution={BASE_RESOLUTION} />);

        expect(screen.queryByRole("heading", { name: "Prior-turn subject receipts" })).toBeNull();
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

        render(<SubjectResolutionPanel resolution={resolution} />);

        expect(
            screen.getByRole("heading", { name: "Prior-turn subject receipts" }),
        ).toBeInTheDocument();
        expect(screen.getByText("subr_0001")).toBeInTheDocument();
        expect(screen.getByText("result_prior_0001")).toBeInTheDocument();
        expect(screen.getByText("applied")).toBeInTheDocument();
        expect(screen.getByText("subr_0002")).toBeInTheDocument();
        // The raw contract term is shown, not just a badge color
        // (`@/lib/presentation.ts`'s own rule: the tone never hides the term).
        expect(screen.getByText("skipped stale graph epoch")).toBeInTheDocument();
    });
});
