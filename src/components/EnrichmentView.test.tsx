import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { EnrichmentView, renderFailureFor } from "@/components/EnrichmentView";
import type { InvestigationResult } from "@/lib/contracts";
import { buildComposition } from "@/lib/enrichment/compose";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import { mockScenarios } from "@/test/fixtures/investigations";

const result = canonicalResult as unknown as InvestigationResult;

const VALID = `root = Answer("@result.deterministic_answer", [prose, cov, lim])
prose = Prose("@result.direct_judgment", [ev])
ev = EvidenceRef("@result.evidence_ref_ids.0")
cov = Coverage("@result.coverage.partial", [src])
src = CoverageSource("@result.coverage.sources.0.source", "@result.coverage.sources.0.state")
lim = Limitations([limItem])
limItem = LimitationItem("@result.limitations.0")`;

describe("EnrichmentView — the enriched path", () => {
    it("renders values resolved from the result, not from the composition", () => {
        render(<EnrichmentView result={result} composition={VALID} />);

        const enriched = screen.getByRole("article", { name: "Enriched answer" });
        // Every one of these is in the RESULT; none is a literal in VALID.
        expect(within(enriched).getByText(result.deterministic_answer)).toBeInTheDocument();
        expect(within(enriched).getByText(result.direct_judgment)).toBeInTheDocument();
        expect(within(enriched).getByText(result.evidence_ref_ids[0]!)).toBeInTheDocument();
        expect(within(enriched).getByText(result.limitations[0]!)).toBeInTheDocument();
        expect(within(enriched).getByText(result.coverage.sources[0]!.source)).toBeInTheDocument();
    });

    it("always renders the mandatory coverage and limitations sections", () => {
        render(<EnrichmentView result={result} composition={VALID} />);

        const enriched = screen.getByRole("article", { name: "Enriched answer" });
        expect(within(enriched).getByLabelText("Coverage")).toBeInTheDocument();
        expect(within(enriched).getByLabelText("Limitations")).toBeInTheDocument();
    });
});

describe("EnrichmentView — the deterministic composition builder", () => {
    /**
     * Validating is not the same as rendering. This closes the last gap between
     * the builder and the screen: a composition our own builder produced from a
     * real result must actually reach the enriched surface, not merely satisfy
     * the validator and then fall back for some other reason.
     */
    it("renders a composition built from the result", () => {
        const composition = buildComposition(result, PRESENTATION_MANIFEST_V1);
        render(<EnrichmentView result={result} composition={composition} />);

        const enriched = screen.getByRole("article", { name: "Enriched answer" });
        expect(within(enriched).getByText(result.deterministic_answer)).toBeInTheDocument();
        expect(within(enriched).getByLabelText("Coverage")).toBeInTheDocument();
        expect(within(enriched).getByLabelText("Limitations")).toBeInTheDocument();
        expect(within(enriched).getByText(result.drivers[0]!.title)).toBeInTheDocument();
        // Never fell back.
        expect(screen.queryByLabelText("Enrichment fell back")).toBeNull();
    });
});

describe("EnrichmentView — falling closed", () => {
    /**
     * The spec's core guarantee: the enriched view fails closed WITHOUT
     * changing the answer. Both views render the same immutable result, so the
     * fallback must show the same answer, not a degraded one.
     */
    it("falls back to the deterministic view without changing the answer", () => {
        render(
            <EnrichmentView
                result={result}
                composition={`root = Answer("Ask Dev is ready to ship.", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`}
            />,
        );

        expect(screen.queryByRole("article", { name: "Enriched answer" })).toBeNull();
        const deterministic = screen.getByRole("article", { name: "Deterministic answer" });
        expect(within(deterministic).getByText(result.deterministic_answer)).toBeInTheDocument();

        // And the invented headline appears NOWHERE — not in the fallback, not
        // in the explanation.
        expect(screen.queryByText("Ask Dev is ready to ship.")).toBeNull();
    });

    it("names the predicate that caused the fallback", () => {
        render(
            <EnrichmentView
                result={result}
                composition={`root = Answer("@result.deterministic_answer", [lim])
lim = Limitations([])`}
            />,
        );

        const panel = screen.getByLabelText("Enrichment fell back");
        expect(within(panel).getByText(/missing_mandatory_section/)).toBeInTheDocument();
    });

    it("falls back rather than partially rendering an unknown component", () => {
        render(
            <EnrichmentView
                result={result}
                composition={`root = Answer("@result.deterministic_answer", [prose, bad, cov, lim])
prose = Prose("@result.direct_judgment")
bad = MarkdownHtml("<img src=x onerror=alert(1)>")
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([])`}
            />,
        );

        // OpenUI on its own would have dropped `bad` and rendered `prose`.
        // Nothing enriched may reach the screen.
        expect(screen.queryByRole("article", { name: "Enriched answer" })).toBeNull();
        expect(screen.getByRole("article", { name: "Deterministic answer" })).toBeInTheDocument();
    });

    it("falls back on a Query(), and never executes it", () => {
        render(
            <EnrichmentView
                result={result}
                composition={`${VALID}
data = Query("get_metrics", {project: "ask_dev"})`}
            />,
        );

        expect(screen.queryByRole("article", { name: "Enriched answer" })).toBeNull();
        const panel = screen.getByLabelText("Enrichment fell back");
        expect(within(panel).getByText(/query_statements/)).toBeInTheDocument();
    });
});

describe("EnrichmentView — a clarification never becomes a dead end", () => {
    /**
     * C3. A clarification is an INTERACTION, not an answer to present. The
     * closed library has no candidate or choice component, so an enrichment
     * render of one showed an empty answer with no way to re-ask. It now routes
     * to the deterministic panel, which can actually offer the choice.
     */
    const clarification = mockScenarios().find((s) => s.id === "clarification")!.result;

    it("routes a clarification to the choice UI instead of rendering an empty answer", () => {
        render(
            <EnrichmentView
                composition={buildComposition(clarification, PRESENTATION_MANIFEST_V1)}
                onConfirmCandidates={vi.fn()}
                onToggleCandidate={vi.fn()}
                result={clarification}
            />,
        );

        expect(
            screen.getByRole("region", { name: "Which subject did you mean?" }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Select / }).length).toBeGreaterThan(0);
        expect(screen.queryByRole("article", { name: "Enriched answer" })).toBeNull();
    });

    /**
     * The wrapper must not claim more than the component it defers to will
     * deliver. Its copy promised "where the choice can be made"
     * unconditionally while the callback-less panel correctly said re-asking
     * was unavailable — sending a read-only caller somewhere that would refuse
     * them.
     */
    it("promises no choice anywhere when it cannot offer one", () => {
        const { container } = render(
            <EnrichmentView
                composition={buildComposition(clarification, PRESENTATION_MANIFEST_V1)}
                result={clarification}
            />,
        );

        expect(container.textContent).not.toMatch(/where the choice can be made/i);
        // No interrogative heading either: the wrapper and the panel now agree
        // that nothing here promises a choice.
        expect(container.textContent).not.toMatch(/which subject did you mean/i);
        expect(container.textContent).toMatch(/cannot re-ask/i);
        expect(screen.queryByRole("button", { name: /^Select / })).toBeNull();
        // The candidates are still shown — inspection-only, not hidden.
        for (const candidate of clarification.subject_resolution.candidates) {
            expect(screen.getByText(candidate.subject.label)).toBeInTheDocument();
        }
    });

    it("carries the re-ask handlers through, so the choice is actionable", async () => {
        const onToggle = vi.fn();
        const onConfirm = vi.fn();
        const user = userEvent.setup();
        render(
            <EnrichmentView
                composition={buildComposition(clarification, PRESENTATION_MANIFEST_V1)}
                onConfirmCandidates={onConfirm}
                onToggleCandidate={onToggle}
                result={clarification}
            />,
        );

        const candidate = clarification.subject_resolution.candidates[0]!;
        await user.click(screen.getByRole("button", { name: `Select ${candidate.subject.label}` }));
        expect(onToggle).toHaveBeenCalledWith(candidate.receipt_id);
    });
});

describe("EnrichmentView — a runtime failure does not latch across results", () => {
    /**
     * C4. A runtime failure belonged to the component rather than to the
     * result, so one genuine renderer error forced every later valid result
     * into fallback for the life of the session.
     *
     * Tested through the pure helper, deliberately. The validator rejects every
     * composition that could make a renderer throw, so the runtime path has no
     * reachable trigger today — an earlier version of this test drove a
     * "broken" composition through the component and passed, but it was
     * exercising the VALIDATION fallback while appearing to cover this one.
     * Mutation testing caught that: reintroducing the latch left it green.
     */
    const failure = { key: "result_a\u0000composition_a", message: "render-error: boom" };

    it("applies a failure to the render it belongs to", () => {
        expect(renderFailureFor(failure, "result_a\u0000composition_a")).toBe("render-error: boom");
    });

    it("does not apply it to a different result", () => {
        expect(renderFailureFor(failure, "result_b\u0000composition_a")).toBeUndefined();
    });

    it("does not apply it to a different composition for the same result", () => {
        expect(renderFailureFor(failure, "result_a\u0000composition_b")).toBeUndefined();
    });

    it("is undefined when nothing has failed", () => {
        expect(renderFailureFor(undefined, "result_a\u0000composition_a")).toBeUndefined();
    });
});

describe("EnrichmentView — text is text", () => {
    /**
     * A result value that looks like markup must render as characters. The
     * library never uses dangerouslySetInnerHTML, so this holds by
     * construction — this test is what stops that changing quietly.
     */
    it("renders a markup-shaped result value as text, not as markup", () => {
        const tainted = structuredClone(result);
        const scripted = "<script>alert(1)</script>";
        (tainted as { limitations: string[] }).limitations = [scripted];

        const { container } = render(
            <EnrichmentView
                result={tainted}
                composition={`root = Answer("@result.deterministic_answer", [cov, lim])
cov = Coverage("@result.coverage.partial", [])
lim = Limitations([limItem])
limItem = LimitationItem("@result.limitations.0")`}
            />,
        );

        expect(screen.getByText(scripted)).toBeInTheDocument();
        expect(container.querySelector("script")).toBeNull();
    });
});
