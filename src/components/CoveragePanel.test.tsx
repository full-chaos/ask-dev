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
    it("shows a chip per source (mapped name, CHAOS-4673) and the summary sentence, always", () => {
        render(<CoveragePanel coverage={coverage} />);

        const panel = screen.getByTestId("coverage-panel");
        expect(within(panel).getByText("Complete — every source contributed.")).toBeInTheDocument();
        const chipRow = within(panel).getByTestId("coverage-chip-row");
        // CHAOS-4673: the always-visible chip carries the MAPPED source
        // name, never the raw `canonical_fact:*`/`dev-health-ops:*`
        // identifier — that moves behind the closed "Source details"
        // disclosure (see the test below).
        for (const source of coverage.sources) {
            expect(chipRow).not.toHaveTextContent(source.source);
        }
        expect(chipRow).toHaveTextContent("Dev Health — status");
        expect(chipRow).toHaveTextContent("Dev Health — readiness");
        expect(chipRow).toHaveTextContent("Canonical — workload");
    });

    /**
     * codex review round 1 (CHAOS-4581): a color-only (tone) distinction
     * between e.g. `available` and `unauthorized`/`no_data` is exactly the
     * "known gap reads as apparent completeness" failure this panel exists
     * to prevent — the state must be real visible text on the chip, not
     * just a hover title or a color a colorblind reader cannot use.
     */
    it("shows each source's state as visible chip text, not just a color/tooltip", () => {
        const gapCoverage = {
            sources: [
                { source: "canonical_fact:workload", state: "available" as const },
                { source: "dev-health-ops:readiness", state: "unauthorized" as const },
                { source: "canonical_fact:blockers", state: "no_data" as const },
            ],
            partial: true,
            degraded_reasons: [],
        };
        render(<CoveragePanel coverage={gapCoverage} />);
        const chipRow = screen.getByTestId("coverage-chip-row");
        expect(chipRow).toHaveTextContent("Canonical — workload");
        expect(chipRow).toHaveTextContent("available");
        expect(chipRow).toHaveTextContent("Dev Health — readiness");
        expect(chipRow).toHaveTextContent("unauthorized");
        expect(chipRow).toHaveTextContent("Canonical — blockers");
        expect(chipRow).toHaveTextContent("no data");
        // The raw closed-vocabulary source names are not on the
        // always-visible chip row at all (CHAOS-4673 acceptance).
        expect(chipRow).not.toHaveTextContent("canonical_fact:");
        expect(chipRow).not.toHaveTextContent("dev-health-ops:");
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

/**
 * CHAOS-4673: "every degraded reason reads as a plain sentence"; raw
 * `<kind>: unexpanded:<outcome>: ...` strings stay behind a collapsed
 * Details, never on the lead surface.
 */
describe("CoveragePanel — CHAOS-4673 degraded reasons read as plain sentences", () => {
    const rawReason =
        "blockers: unexpanded:policy_unavailable: no resolved subject holds this capability's facts directly and scope expansion did not reach them (origin: team; supported: work_item; policy: none; basis: activity_proxy)";

    it("shows a mapped sentence on the lead surface and the raw reason only inside a collapsed Details", () => {
        render(
            <CoveragePanel
                coverage={{ sources: [], partial: true, degraded_reasons: [rawReason] }}
            />,
        );

        expect(screen.getByRole("heading", { name: "Degraded reasons" })).toBeInTheDocument();
        expect(screen.getByText(/no data-sharing policy is configured/)).toBeInTheDocument();

        // The raw string exists ONLY inside a collapsed <details> — never as
        // sibling text a reader would see without expanding it.
        const raw = screen.getByText(rawReason);
        const details = raw.closest("details")!;
        expect(details).not.toBeNull();
        expect(details).not.toHaveAttribute("open");
        expect(details.getAttribute("data-testid")).toBe("degraded-reason-raw");

        // The mapped sentence element itself carries none of the raw
        // closed-vocabulary tokens (as opposed to some OTHER node in the
        // same list, which the earlier whole-list check could not tell
        // apart from this element).
        const mappedSentence = screen.getByText(/no data-sharing policy is configured/);
        expect(mappedSentence.closest("details")).toBeNull();
        expect(mappedSentence.textContent).not.toContain("unexpanded:policy_unavailable");
        expect(mappedSentence.textContent).not.toContain("activity_proxy");
    });
});
