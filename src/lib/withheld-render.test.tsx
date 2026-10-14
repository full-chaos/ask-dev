import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanonicalResultInspector } from "@/components/CanonicalResultInspector";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { EnrichmentView } from "@/components/EnrichmentView";
import shapesExample from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";

const teamResult = shapesExample as unknown as InvestigationResult;

function personify(source: InvestigationResult): InvestigationResult {
    return {
        ...source,
        cohort: {
            ...source.cohort!,
            kind: "person",
            members: source.cohort!.members.map((m) => ({
                ...m,
                subject: { ...m.subject, kind: "person", canonical_id: "person:ada", label: "Ada" },
            })),
        },
    };
}

describe("P2-5: marker is beside the result, result stays schema-valid", () => {
    it("the withheld result validates against the pinned result schema", () => {
        const { result } = withholdUnrankableRankings(personify(teamResult));
        const verdict = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            result,
        );
        expect(verdict.errors).toEqual([]);
        expect(verdict.valid).toBe(true);
        expect(result).not.toHaveProperty("ranking_withheld");
    });

    it("the boundary returns the marker next to the result", () => {
        const out = withholdUnrankableRankings(personify(teamResult));
        expect(out.rankingWithheld?.reason).toBe("subject_kind_not_ranked");
    });

    it("inspector labels a withheld payload as transformed, an untouched one as exact", () => {
        const w = withholdUnrankableRankings(personify(teamResult));
        const a = render(
            <CanonicalResultInspector rankingWithheld={w.rankingWithheld} result={w.result} />,
        );
        expect(a.container.textContent).toMatch(/transformed by the Workbench/);
        expect(a.container.textContent).not.toMatch(/exactly as ACR returned it/);
        a.unmount();
        const b = render(<CanonicalResultInspector result={teamResult} />);
        expect(b.container.textContent).toMatch(/exactly as ACR returned it/);
        expect(b.container.textContent).not.toMatch(/transformed by the Workbench/);
    });
});

describe("P2-2: withheld parts render as withheld, never as none reported", () => {
    const w = withholdUnrankableRankings(personify(teamResult));

    it("answer view says withheld, not none reported, and does not read Complete", () => {
        const { container } = render(
            <DeterministicAnswerView rankingWithheld={w.rankingWithheld} result={w.result} />,
        );
        const text = container.textContent ?? "";
        for (const none of [
            "No remaining work was reported",
            "No readiness gaps were reported",
            "No conflicting evidence was reported",
            "No evidence was referenced",
            "No drivers were reported",
        ]) {
            expect(text).not.toContain(none);
        }
        expect(container.querySelectorAll('[data-testid="withheld-part"]').length).toBeGreaterThan(
            0,
        );
        const panel = container.querySelector('[data-testid="completeness-panel"]');
        expect(panel?.textContent).toMatch(/withheld/i);
        expect(panel?.textContent).not.toMatch(/\bComplete\b/);
    });

    it("inspector says withheld for paths and canonical facts", () => {
        const { container } = render(
            <CanonicalResultInspector rankingWithheld={w.rankingWithheld} result={w.result} />,
        );
        const text = container.textContent ?? "";
        expect(text).not.toContain("No paths were returned");
        expect(text).not.toContain("No canonical facts were claimed");
        expect(container.querySelectorAll('[data-testid="withheld-part"]').length).toBeGreaterThan(
            1,
        );
    });

    it("enrichment view does not compose an answer from emptied arrays", () => {
        const { container } = render(
            <EnrichmentView composition="" rankingWithheld={w.rankingWithheld} result={w.result} />,
        );
        expect(container.textContent).not.toContain("No evidence was referenced");
        expect(container.querySelectorAll('[data-testid="withheld-part"]').length).toBeGreaterThan(
            0,
        );
    });
});

describe("P2-3: clarification view shows the withheld notice", () => {
    it("shows Ranking not shown on a clarification_required result", () => {
        const source = personify({
            ...teamResult,
            status: "clarification_required",
        });
        const w = withholdUnrankableRankings(source);
        const { container } = render(
            <DeterministicAnswerView rankingWithheld={w.rankingWithheld} result={w.result} />,
        );
        expect(container.querySelector('[data-testid="ranking-withheld-notice"]')).not.toBeNull();
        expect(container.textContent).toMatch(/Ranking not shown/);
    });
});
