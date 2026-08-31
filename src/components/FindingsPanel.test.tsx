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
        expect(screen.getByText(/already shown in full under Readiness gaps/i)).toBeInTheDocument();
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
        expect(screen.getByText(/already shown in full under Readiness gaps/i)).toBeInTheDocument();
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
