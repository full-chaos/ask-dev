import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoveragePanel } from "@/components/CoveragePanel";
import { mockScenarios } from "@/test/fixtures/investigations";

const coverage = mockScenarios().find((s) => s.id === "complete")!.result.coverage;

/**
 * CHAOS-4581: coverage becomes a compact strip — a one-line summary plus a
 * tone-coded chip per source, always visible; the full per-source
 * reason/observed-at breakdown moves behind a closed `<details>`, never
 * removed (AGENTS.md: "hiding a known gap would turn it into apparent
 * completeness").
 */
describe("CoveragePanel — compact strip (CHAOS-4581)", () => {
    it("shows a chip per source and the summary sentence, always", () => {
        render(<CoveragePanel coverage={coverage} />);

        const panel = screen.getByTestId("coverage-panel");
        expect(within(panel).getByText("Complete — every source contributed.")).toBeInTheDocument();
        for (const source of coverage.sources) {
            expect(
                within(within(panel).getByTestId("coverage-chip-row")).getByText(source.source),
            ).toBeInTheDocument();
        }
    });

    it("keeps the full per-source detail reachable behind a closed disclosure", () => {
        render(<CoveragePanel coverage={coverage} />);

        const panel = screen.getByTestId("coverage-panel");
        const details = within(panel).getByText("Source details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        for (const source of coverage.sources) {
            expect(details).toHaveTextContent(source.source);
            if (source.observed_at !== undefined) {
                expect(details).toHaveTextContent(`observed at ${source.observed_at}`);
            }
        }
    });

    it("still says so explicitly when there are no sources at all", () => {
        render(<CoveragePanel coverage={{ sources: [], partial: true, degraded_reasons: [] }} />);
        expect(screen.getByText("No sources were recorded.")).toBeInTheDocument();
    });

    it("gives each mounted instance its own heading id (CHAOS-4510)", () => {
        render(
            <>
                <CoveragePanel coverage={coverage} />
                <CoveragePanel coverage={coverage} />
            </>,
        );
        const [first, second] = screen.getAllByTestId("coverage-panel");
        expect(first!.getAttribute("aria-labelledby")).not.toBe(
            second!.getAttribute("aria-labelledby"),
        );
    });
});
