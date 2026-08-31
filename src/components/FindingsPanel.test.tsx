import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FindingsPanel } from "@/components/FindingsPanel";
import type { DedupedFinding } from "@/lib/fact-dedup";

const PRIMARY: DedupedFinding = {
    finding: {
        finding_id: "finding_readiness_gap",
        kind: "readiness",
        summary: "Release acceptance remains incomplete.",
        evidence_ref_ids: ["evidence_0001"],
    },
    isDuplicate: false,
    primarySurface: "readiness_gaps",
};

const DUPLICATE: DedupedFinding = {
    finding: {
        finding_id: "finding_remaining_work_dup",
        kind: "readiness",
        summary: "Release acceptance remains incomplete.",
        evidence_ref_ids: ["evidence_0001"],
    },
    isDuplicate: true,
    primarySurface: "readiness_gaps",
};

/**
 * CHAOS-4669 defect 1: a duplicate fact renders as a compact one-line
 * cross-reference, never a second full copy.
 */
describe("FindingsPanel — CHAOS-4669 defect 1 dedup rendering", () => {
    it("renders a non-duplicate finding in full (summary + evidence)", () => {
        render(
            <FindingsPanel
                title="Readiness gaps"
                findings={[PRIMARY]}
                emptyMessage="No readiness gaps were reported."
            />,
        );
        expect(screen.getByText("Release acceptance remains incomplete.")).toBeInTheDocument();
    });

    it("renders a duplicate finding as a compact reference, not the full summary text", () => {
        render(
            <FindingsPanel
                title="Remaining work"
                findings={[DUPLICATE]}
                emptyMessage="No remaining work was reported."
            />,
        );
        // The full sentence never appears a second time.
        expect(screen.queryByText("Release acceptance remains incomplete.")).toBeNull();
        expect(screen.getByText(/also shown in full under Readiness gaps/i)).toBeInTheDocument();
    });

    it("a mixed list shows one full record and one reference, never two full copies", () => {
        render(
            <FindingsPanel
                title="Remaining work"
                findings={[PRIMARY, DUPLICATE]}
                emptyMessage="No remaining work was reported."
            />,
        );
        expect(screen.getAllByText("Release acceptance remains incomplete.").length).toBe(1);
        expect(screen.getByText(/also shown in full under Readiness gaps/i)).toBeInTheDocument();
    });

    /**
     * codex round 2, finding 3 (EXECUTED repro): a duplicate identified by
     * shared `claimed_fact_ids`/text can still carry evidence its
     * cross-referenced primary does not — the duplicate branch rendered
     * only the reference sentence, silently dropping that unique evidence.
     * AGENTS.md: a missing fact must never look like the service never
     * sent it. The duplicate's own evidence must stay reachable.
     */
    it("still renders a duplicate's own evidence, never silently drops it (codex round 2, finding 3)", () => {
        const duplicateWithOwnEvidence: DedupedFinding = {
            finding: {
                finding_id: "finding_extra_evidence",
                kind: "readiness",
                summary: "Release acceptance remains incomplete.",
                evidence_ref_ids: ["acr:v1:pull-request:202"],
            },
            isDuplicate: true,
            primarySurface: "readiness_gaps",
        };
        render(
            <FindingsPanel
                title="Remaining work"
                findings={[duplicateWithOwnEvidence]}
                emptyMessage="No remaining work was reported."
            />,
        );
        expect(screen.getByText(/also shown in full under Readiness gaps/i)).toBeInTheDocument();
        expect(screen.getByTestId("evidence-ref-raw-ids")).toBeInTheDocument();
    });

    /**
     * codex round 3, finding 3 (EXECUTED repro): `DeterministicAnswerView`
     * renders "Remaining work" BEFORE "Readiness gaps" on the page, but
     * `readiness_gaps` outranks `remaining_work` in the dedup priority — so
     * a remaining_work reference can point at a primary that has not
     * rendered yet. The wording must not claim a position it cannot
     * guarantee.
     */
    it("never claims the primary was 'already' shown — the primary can render below this reference", () => {
        render(
            <FindingsPanel
                title="Remaining work"
                findings={[DUPLICATE]}
                emptyMessage="No remaining work was reported."
            />,
        );
        expect(screen.queryByText(/already/i)).toBeNull();
        expect(screen.getByText(/also shown in full under Readiness gaps/i)).toBeInTheDocument();
    });

    it("still says so explicitly when there are no findings", () => {
        render(
            <FindingsPanel
                title="Conflicts"
                findings={[]}
                emptyMessage="No conflicting evidence was reported."
            />,
        );
        expect(screen.getByText("No conflicting evidence was reported.")).toBeInTheDocument();
    });
});
