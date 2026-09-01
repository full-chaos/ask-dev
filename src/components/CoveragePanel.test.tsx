import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoveragePanel } from "@/components/CoveragePanel";
import { mockScenarios } from "@/test/fixtures/investigations";

const degradedCoverage = mockScenarios().find((s) => s.id === "degraded")!.result.coverage;
const legacyCoverage = mockScenarios().find((s) => s.id === "degraded-legacy")!.result.coverage;

/**
 * CHAOS-4581: coverage becomes a compact strip — a one-line summary plus a
 * tone-coded chip per source, always visible; the full per-source
 * reason/observed-at breakdown moves behind a closed `<details>`, never
 * removed (AGENTS.md: "hiding a known gap would turn it into apparent
 * completeness").
 */
describe("CoveragePanel — compact strip (CHAOS-4581)", () => {
    it("shows a chip per source (engine-provided label, CHAOS-4690) and the summary sentence, always", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);

        const panel = screen.getByTestId("coverage-panel");
        expect(
            within(panel).getByText("Partial — some sources did not contribute."),
        ).toBeInTheDocument();
        const chipRow = within(panel).getByTestId("coverage-chip-row");
        // CHAOS-4673/CHAOS-4690: the always-visible chip carries the
        // ENGINE'S OWN `label`, never the raw `canonical_fact:*`/
        // `dev-health-ops:*` identifier — that moves behind the closed
        // "Source details" disclosure (see the test below).
        for (const source of degradedCoverage.sources) {
            expect(chipRow).not.toHaveTextContent(source.source);
        }
        expect(chipRow).toHaveTextContent("Dev Health — status");
        expect(chipRow).toHaveTextContent("Canonical facts — metrics");
        expect(chipRow).toHaveTextContent("Canonical facts — incident");
    });

    /**
     * codex review round 1 (CHAOS-4581): a color-only (tone) distinction
     * between e.g. `available` and `unauthorized`/`no_data` is exactly the
     * "known gap reads as apparent completeness" failure this panel exists
     * to prevent — the state must be real visible text on the chip, not
     * just a hover title or a color a colorblind reader cannot use.
     */
    it("shows each source's engine-provided state_label as visible chip text, not just a color/tooltip", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);
        const chipRow = screen.getByTestId("coverage-chip-row");
        expect(chipRow).toHaveTextContent("Dev Health — status");
        expect(chipRow).toHaveTextContent("available");
        expect(chipRow).toHaveTextContent("Canonical facts — incident");
        expect(chipRow).toHaveTextContent("not authorized");
        // The raw closed-vocabulary source names are not on the
        // always-visible chip row at all (CHAOS-4673 acceptance).
        expect(chipRow).not.toHaveTextContent("canonical_fact:");
        expect(chipRow).not.toHaveTextContent("dev-health-ops:");
    });

    /**
     * NAMED EXCEPTION (CHAOS-4691 pin delta item 6): a legacy (pre-4690)
     * stored result carries no `label`/`state_label` on any source. The
     * chip falls through to the deterministic generic floor — never a
     * client-side reconstruction of what the raw source name means (that is
     * exactly the deleted `vocab-mapping.ts` shape).
     */
    it("falls back to the generic 'Source' floor for a legacy result's sources (no label/state_label on the wire)", () => {
        render(<CoveragePanel coverage={legacyCoverage} />);
        const chipRow = screen.getByTestId("coverage-chip-row");
        // Five sources, every one falls back to the same generic label —
        // the raw closed-vocabulary identifiers still never leak onto the
        // always-visible chip row.
        for (const source of legacyCoverage.sources) {
            expect(chipRow).not.toHaveTextContent(source.source);
        }
        const chips = within(chipRow).getAllByText(/^Source ·/);
        expect(chips.length).toBe(legacyCoverage.sources.length);
        // The raw enum state still renders via `humanizeTerm` (presentation
        // structure — underscores to spaces, not a phrasing table) even
        // without an engine `state_label`: "unauthorized" has no
        // underscore to replace, so it renders unchanged (never the
        // engine's OWN "not authorized" phrase, which only ships with
        // `state_label`).
        expect(chipRow).toHaveTextContent("available");
        expect(chipRow).toHaveTextContent("unauthorized");
    });

    it("keeps the full per-source detail reachable behind a closed disclosure", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);

        const panel = screen.getByTestId("coverage-panel");
        const details = within(panel).getByText("Source details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        for (const source of degradedCoverage.sources) {
            expect(details).toHaveTextContent(source.source);
            if (source.observed_at !== undefined) {
                expect(details).toHaveTextContent(`observed at ${source.observed_at}`);
            }
        }
    });

    it("still says so explicitly when there are no sources at all", () => {
        render(<CoveragePanel coverage={{ sources: [], partial: true, degraded_reasons: [] }} />);
        expect(screen.getByText("No sources were recorded.")).toBeInTheDocument();
        // CHAOS-4524/4568: the headline itself must be the no-sources
        // state — a vacuous version of this test could pass merely because
        // SOME element elsewhere said "No sources were recorded." while the
        // headline above it still claimed "Partial"/"Complete".
        expect(
            screen.queryByText("Partial — some sources did not contribute."),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Complete — every source contributed.")).not.toBeInTheDocument();
    });

    /**
     * CHAOS-4524 / CHAOS-4568: zero sources is absence of evidence, not
     * completeness. `partial === false` over an empty source list must
     * never render the "Complete — every source contributed." headline —
     * that reads a known gap as apparent completeness, the one failure
     * this panel's doc comment says it exists to prevent (AGENTS.md check
     * 12: missing is not healthy).
     */
    it("never shows the Complete headline when zero sources were recorded, even with partial=false", () => {
        render(<CoveragePanel coverage={{ sources: [], partial: false, degraded_reasons: [] }} />);
        const panel = screen.getByTestId("coverage-panel");
        expect(
            within(panel).queryByText("Complete — every source contributed."),
        ).not.toBeInTheDocument();
        expect(
            within(panel).queryByText("Partial — some sources did not contribute."),
        ).not.toBeInTheDocument();
        expect(within(panel).getByText("No sources were recorded.")).toBeInTheDocument();
    });

    it("gives each mounted instance its own heading id (CHAOS-4510)", () => {
        render(
            <>
                <CoveragePanel coverage={degradedCoverage} />
                <CoveragePanel coverage={degradedCoverage} />
            </>,
        );
        const [first, second] = screen.getAllByTestId("coverage-panel");
        expect(first!.getAttribute("aria-labelledby")).not.toBe(
            second!.getAttribute("aria-labelledby"),
        );
    });
});

/**
 * CHAOS-4690/CHAOS-4691: "every degraded reason reads as a plain sentence"
 * (the ticket's own acceptance wording) now comes from the engine's own
 * `coverage.details[]` — synthesis-phrased (`.phrasing`) when the model
 * chose to phrase it, the deterministic `.label` floor otherwise (never
 * both blank: `label` is contract-required on every detail). Raw
 * `<kind>: unexpanded:<outcome>: ...`-shaped strings stay behind a
 * collapsed Details, never on the lead surface — same acceptance bar the
 * deleted `vocab-mapping.ts` used to satisfy by parsing; this satisfies it
 * by rendering what the engine already composed.
 */
describe("CoveragePanel — CHAOS-4690 degraded reasons: engine Phrasing when present, Label floor when absent", () => {
    it("renders the model's synthesis-phrased sentence when the detail carries one", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);

        expect(screen.getByRole("heading", { name: "Degraded reasons" })).toBeInTheDocument();
        // cov-incidents-unauthorized carries a `phrasing` in the fixture.
        expect(
            screen.getByText(
                "Incident data wasn't authorized for this account, so it's left out here.",
            ),
        ).toBeInTheDocument();
        // The deterministic Label for the SAME detail is not ALSO rendered
        // as a second, separate sentence — Phrasing supersedes it.
        expect(screen.queryByText("Incident facts are not authorized for this account")).toBeNull();
    });

    it("renders the deterministic Label floor when a detail carries no phrasing", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);

        // cov-metrics-stale carries no `phrasing` in the fixture (telemetry-
        // observed live: the model MAY decline to phrase a disclosure).
        expect(screen.getByText("Metrics facts may be out of date")).toBeInTheDocument();
    });

    it("keeps each detail's raw string reachable only inside its own collapsed Details", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);

        const raw = screen.getByText("metrics: canonical fact capability returned stale");
        const details = raw.closest("details")!;
        expect(details).not.toBeNull();
        expect(details).not.toHaveAttribute("open");
        expect(details.getAttribute("data-testid")).toBe("degraded-reason-raw");

        const phrasedSentence = screen.getByText(
            "Incident data wasn't authorized for this account, so it's left out here.",
        );
        expect(phrasedSentence.closest("details")).toBeNull();
    });

    /** A non-degrading detail (fixture's `cov-workload-pruned`) never appears in this list. */
    it("never lists a non-degrading detail under Degraded reasons", () => {
        render(<CoveragePanel coverage={degradedCoverage} />);
        expect(screen.queryByText("Workload facts do not apply to what was asked")).toBeNull();
    });

    /**
     * NAMED EXCEPTION (CHAOS-4691 pin delta item 6, chris-ruled): a legacy
     * (pre-4690) stored result carries `degraded_reasons[]` but no
     * `coverage.details` AT ALL (absent, not `[]`). The renderer must not
     * reconstruct a sentence by parsing that raw string — the exact banned
     * shape this ticket deletes — so every legacy entry gets the SAME
     * fixed, content-independent generic sentence, with the raw string
     * still one click away.
     */
    it("renders a fixed generic sentence per legacy degraded_reasons entry, never a parsed one", () => {
        render(<CoveragePanel coverage={legacyCoverage} />);

        expect(screen.getByRole("heading", { name: "Degraded reasons" })).toBeInTheDocument();
        const genericSentences = screen.getAllByText(
            "This source didn't fully contribute; see details for the reason.",
        );
        // One per legacy `degraded_reasons` entry — the fixture carries 3.
        expect(genericSentences.length).toBe(legacyCoverage.degraded_reasons!.length);

        for (const reason of legacyCoverage.degraded_reasons!) {
            const raw = screen.getByText(reason);
            const details = raw.closest("details")!;
            expect(details).not.toBeNull();
            expect(details).not.toHaveAttribute("open");
        }

        // The old vocab-mapping.ts sentence for this exact raw shape never
        // reappears (that module, and the sentence it composed, are both
        // deleted).
        expect(screen.queryByText(/no data-sharing policy is configured/)).toBeNull();
        expect(screen.queryByText(/Incident facts are not authorized/)).toBeNull();
    });
});

/**
 * codex round 1, P2, EXECUTED: `Coverage.sources[].label`/`.state_label`
 * carry no `minLength` on the wire, and `CoverageDetail.phrasing` likewise
 * — so `""` is schema-valid for all three. A bare `?? fallback` only
 * catches `undefined`, not an empty/whitespace-only string, so a
 * schema-valid but malformed engine response could render a blank chip or
 * a blank degraded-reason sentence instead of falling through to the
 * deterministic generic floor. `nonBlank` (`@/lib/presentation`) closes
 * that gap; these tests pin it at the render boundary, mutable back to
 * `??` to prove they fail for the right reason.
 */
describe("CoveragePanel — codex round 1 P2: blank engine strings fall through to the generic floor", () => {
    it("falls back to the generic 'Source' floor when label is present but blank/whitespace-only", () => {
        const coverage = {
            sources: [
                { source: "canonical_fact:workload", state: "available" as const, label: "   " },
            ],
            partial: false,
            degraded_reasons: [],
        };
        render(<CoveragePanel coverage={coverage} />);
        const chipRow = screen.getByTestId("coverage-chip-row");
        expect(chipRow).toHaveTextContent("Source · available");
        expect(chipRow.textContent).not.toMatch(/^\s*·/); // never a blank name before the separator
    });

    it("falls back to humanizeTerm(state) when state_label is present but blank", () => {
        const coverage = {
            sources: [
                {
                    source: "canonical_fact:workload",
                    state: "unauthorized" as const,
                    state_label: "",
                },
            ],
            partial: false,
            degraded_reasons: [],
        };
        render(<CoveragePanel coverage={coverage} />);
        expect(screen.getByTestId("coverage-chip-row")).toHaveTextContent("Source · unauthorized");
    });

    it("falls back to the deterministic Label when phrasing is present but blank/whitespace-only", () => {
        const coverage = {
            sources: [],
            partial: true,
            degraded_reasons: [],
            details: [
                {
                    detail_id: "cov-blank-phrasing",
                    source: "canonical_fact:metrics",
                    code: "fact_provider_reported" as const,
                    degrading: true,
                    label: "Metrics facts may be out of date",
                    phrasing: " ",
                },
            ],
        };
        render(<CoveragePanel coverage={coverage} />);
        expect(screen.getByText("Metrics facts may be out of date")).toBeInTheDocument();
    });

    /**
     * codex round 2, P2, EXECUTED: `CoverageDetail.label` is contract-
     * required, but its only wire bound is `minLength: 1` (no
     * non-whitespace requirement), so a schema-valid detail can carry
     * `label: " "` — the same shape `phrasing` can carry. When BOTH are
     * blank there is nothing left to fall back to except the generic
     * sentence (never a blank paragraph on the always-visible surface).
     */
    it("falls back to the generic sentence when BOTH phrasing and the required label are blank/whitespace-only", () => {
        const coverage = {
            sources: [],
            partial: true,
            degraded_reasons: [],
            details: [
                {
                    detail_id: "cov-blank-everything",
                    source: "canonical_fact:metrics",
                    code: "fact_provider_reported" as const,
                    degrading: true,
                    label: " ",
                    phrasing: " ",
                },
            ],
        };
        render(<CoveragePanel coverage={coverage} />);
        expect(
            screen.getByText("This source didn't fully contribute; see details for the reason."),
        ).toBeInTheDocument();
        // Never a lone blank paragraph in the degraded-reasons list.
        const list = screen.getByRole("heading", { name: "Degraded reasons" }).closest("section")!;
        expect(list.querySelector(".record__body")!.textContent.trim()).not.toBe("");
    });
});
