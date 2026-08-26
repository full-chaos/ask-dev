import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import type { InvestigationResult } from "@/lib/contracts";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * codex finding (chaos4171pr3-codex-r2): this inspector renders its OWN
 * bespoke copy of `subject_resolution` (candidates/committed), separate from
 * `SubjectResolutionPanel` — the disclosure fix made there
 * (`DeterministicAnswerView`'s clarification branch) did not cover this,
 * distinct, "raw" Workbench view. Round 2 flagged: a clarification result
 * with a skipped prior receipt showed candidates here but no disclosure —
 * the same dropped-choice-goes-invisible failure the round-1 fix closed
 * elsewhere. Fixed by rendering the same shared `PriorSubjectReceiptDisclosure`
 * component here too.
 */
describe("CanonicalResultInspector: prior-subject-receipt disclosure", () => {
    function resultWithDroppedReceipt(): InvestigationResult {
        const base = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
        return {
            ...base,
            subject_resolution: {
                ...base.subject_resolution,
                prior_subject_receipt_dispositions: [
                    {
                        prior_result_id: "result_prior_0001",
                        receipt_id: "subr_0001",
                        disposition: "skipped_no_match",
                    },
                ],
            },
        };
    }

    it("renders the disclosure in the raw inspector's own subject-resolution section", () => {
        render(<CanonicalResultInspector result={resultWithDroppedReceipt()} />);

        expect(
            screen.getByRole("heading", { name: "Prior-turn subject receipts" }),
        ).toBeInTheDocument();
        expect(screen.getByText("subr_0001")).toBeInTheDocument();
        expect(screen.getByText("skipped no match")).toBeInTheDocument();
    });

    it("renders nothing extra when the result carries no prior-receipt dispositions", () => {
        const base = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
        render(<CanonicalResultInspector result={base} />);

        expect(screen.queryByRole("heading", { name: "Prior-turn subject receipts" })).toBeNull();
    });
});
