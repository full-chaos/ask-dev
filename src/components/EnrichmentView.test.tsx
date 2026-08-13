import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { EnrichmentView } from "@/components/EnrichmentView";
import type { InvestigationResult } from "@/lib/contracts";

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
