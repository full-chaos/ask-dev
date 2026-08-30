import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DriversPanel } from "@/components/DriversPanel";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { CohortMember, DriverJudgment, InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";

const base = mockScenarios().find((s) => s.id === "complete")!.result;
const result = canonicalResult as unknown as InvestigationResult;

/**
 * The narrated driver judgments behind a cohort ranking (CHAOS-4449, design
 * doc §5a). These are ordinary `DriverJudgment`s — the panel has no
 * cohort-specific branch — so these assertions prove the generic narration
 * actually carries what a cohort answer needs: standing, title, summary,
 * epistemic status, affected subject, and the claimed facts cited.
 *
 * CHAOS-4581: migrated verbatim from `AnswerPanel.test.tsx` — this content
 * moved out of `AnswerPanel` into its own `DriversPanel` (principal driver
 * cards, leading the answer rather than trailing under the prose); the
 * assertions themselves are unchanged, only the component under test and
 * the fact that evidence/claimed-fact citations now sit behind a closed
 * `<details>` (still present in the DOM, so `getByText`/`within` still find
 * them — collapsed only visually).
 */
const cohortDrivers = result.drivers.filter((driver) => driver.driver_id.startsWith("cohort-"));

describe("DriversPanel — narrated driver judgments", () => {
    it("the pinned example carries cohort driver judgments at all", () => {
        // Red on the parent pin: the example had no cohort drivers.
        expect(cohortDrivers.length).toBeGreaterThan(0);
    });

    it("renders each driver's standing, title and summary", () => {
        render(<DriversPanel result={result} />);

        expect(screen.getByText("CHAOS: operational deficiencies")).toBeInTheDocument();
        expect(screen.getByText("CHAOS: health risk")).toBeInTheDocument();
        expect(screen.getByText("CHAOS: readiness gap")).toBeInTheDocument();
        expect(
            screen.getByText(/operational deficiencies \(weight 20, value 1\.00\)/),
        ).toBeInTheDocument();
    });

    it("shows a principal driver's standing distinctly from a contributing one", () => {
        render(<DriversPanel result={result} />);
        expect(screen.getAllByTitle("principal").length).toBeGreaterThan(0);
        expect(screen.getAllByTitle("contributing").length).toBeGreaterThan(0);
    });

    it("labels an inferred judgment as inferred, never as an observation", () => {
        // Every cohort driver is `epistemic_status: "inferred"`. Rendering it
        // as an observation would upgrade a rule-derived judgment into a
        // measured fact — the distinction North Star check 12 turns on.
        expect(cohortDrivers.every((driver) => driver.epistemic_status === "inferred")).toBe(true);

        render(<DriversPanel result={result} />);
        const record = screen.getByText("CHAOS: operational deficiencies").closest("li")!;
        expect(within(record).getByText(/inferred/)).toBeInTheDocument();
        expect(within(record).queryByText(/\bobserved\b/)).not.toBeInTheDocument();
    });

    it("names who each judgment is about", () => {
        render(<DriversPanel result={result} />);
        const record = screen.getByText("CHAOS: operational deficiencies").closest("li")!;
        expect(within(record).getByTestId("driver-affected-subjects")).toHaveTextContent(
            "CHAOS (team)",
        );
    });

    it("cites the claimed facts a judgment rests on, verbatim", () => {
        const [driver] = cohortDrivers;
        const claimId = driver!.claimed_fact_ids![0]!;

        render(<DriversPanel result={result} />);
        const record = screen.getByText(driver!.title).closest("li")!;
        expect(within(record).getByText(claimId)).toBeInTheDocument();
        // The cited claim really is one the result carries — a citation to a
        // claim that is not in the payload would be a dangling reference.
        expect(result.claimed_facts.some((fact) => fact.claim_id === claimId)).toBe(true);
    });
});

/**
 * CHAOS-4581: "principal driver cards" — a one-line summary always visible;
 * category/derivation/confidence, qualification, affected subjects, and
 * evidence behind an expand (the pop-up-card reference: "details behind
 * expand/click, not every field inline").
 */
describe("DriversPanel — pop-up card chrome (CHAOS-4581)", () => {
    it("renders a card per driver with a badge and the summary visible", () => {
        render(<DriversPanel result={base} />);

        const panel = screen.getByTestId("drivers-panel");
        expect(within(panel).getByRole("heading", { name: "Drivers" })).toBeInTheDocument();
        for (const driver of base.drivers) {
            expect(within(panel).getByText(driver.title)).toBeInTheDocument();
            expect(within(panel).getByText(driver.summary)).toBeInTheDocument();
        }
    });

    it("collapses evidence/category/confidence detail behind a closed disclosure by default", () => {
        render(<DriversPanel result={base} />);
        const driver = base.drivers[0]!;
        const card = screen.getByText(driver.title).closest("li")!;
        const details = within(card).getByText("Details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        // The detail is still IN the document (nothing removed, only
        // collapsed) — findable via its own confidence text.
        expect(within(card).getByText(/confidence/i)).toBeInTheDocument();
    });

    it("says so explicitly when the service reported no drivers", () => {
        render(<DriversPanel result={{ ...base, drivers: [] }} />);
        expect(screen.getByText("No drivers were reported.")).toBeInTheDocument();
    });

    it("gives each mounted instance its own heading id (CHAOS-4510)", () => {
        render(
            <>
                <DriversPanel result={base} />
                <DriversPanel result={{ ...base, result_id: "result_other" }} />
            </>,
        );
        const [first, second] = screen.getAllByTestId("drivers-panel");
        expect(first!.getAttribute("aria-labelledby")).not.toBe(
            second!.getAttribute("aria-labelledby"),
        );
    });
});

/**
 * Scope addition, team-lead 2026-08-30 (folding in a lane-4580 close-out
 * finding, CHAOS-4580 item 3): a `standing: "withheld"` driver's own
 * `summary` restates the SAME `missing_signals` list `CohortRankingPanel`'s
 * table footnote already states once for that member — visible twice
 * otherwise. Missing signals stay stated once; a withheld card shows a
 * short reference instead, with the original summary still reachable
 * (unmodified) behind Details.
 */
describe("DriversPanel — a withheld driver references the table instead of restating missing signals", () => {
    // codex review round 3: the short reference is only safe for a member
    // that BOTH is ranked AND carries `missing_signals` — `CohortRankingPanel`
    // only emits the footnote for that exact case. `base.cohort`'s own
    // "CHAOS" member is ranked but has no `missing_signals` in the pinned
    // fixture, so it is added here rather than invented on an unrelated id —
    // the driver below cites the SAME real member.
    const rankedMember = base.cohort!.members.find((m) => m.subject.label === "CHAOS")!;
    const withheldDriver: DriverJudgment = {
        ...base.drivers[0]!,
        driver_id: "driver_withheld_0001",
        standing: "withheld",
        title: "CHAOS: score withheld",
        summary:
            "CHAOS's score is withheld because readiness.coverage_gap and workload.forecast_pressure are missing.",
        affected_subjects: [rankedMember.subject],
    };
    // codex review round 2: the reference is only safe when Ranked Teams is
    // actually rendering for this result — `base` alone is interpreted
    // `single_subject` (see below), so these tests force a cohort-intent
    // shape to reach the scenario they're pinning. The no-cohort-visible
    // case is its own test, further down.
    const cohortShapedResult: InvestigationResult = {
        ...base,
        interpretation: { ...base.interpretation, shape: "discovered_cohort" },
        cohort: {
            ...base.cohort!,
            members: base.cohort!.members.map((m) =>
                m.subject.label === "CHAOS"
                    ? {
                          ...m,
                          missing_signals: ["readiness.coverage_gap", "workload.forecast_pressure"],
                      }
                    : m,
            ),
        },
    };

    it("does not show the withheld driver's full summary in the always-visible body", () => {
        render(<DriversPanel result={{ ...cohortShapedResult, drivers: [withheldDriver] }} />);

        const card = screen.getByText(withheldDriver.title).closest("li")!;
        // The always-visible summary paragraph (`.record__body`, same
        // element every non-withheld card shows its summary in) carries the
        // short reference, not the restated missing-signals prose.
        const visibleBody = card.querySelector(":scope > .record__body")!;
        expect(visibleBody.textContent).not.toContain(withheldDriver.summary);
        expect(
            within(card).getByText(/missing signals are listed once, in Ranked teams/i),
        ).toBeInTheDocument();
    });

    it("keeps the original summary reachable, unmodified, behind Details", () => {
        render(<DriversPanel result={{ ...cohortShapedResult, drivers: [withheldDriver] }} />);

        const card = screen.getByText(withheldDriver.title).closest("li")!;
        const details = within(card).getByText("Details").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        expect(within(details).getByText(withheldDriver.summary)).toBeInTheDocument();
    });

    it("does not shorten a non-withheld driver's summary the same way", () => {
        render(<DriversPanel result={base} />);
        // The pre-existing "renders a card ... summary visible" test already
        // pins this for every driver in `base`; this asserts none of them
        // happens to be standing:"withheld" already, so that coverage is
        // real and not accidentally vacuous.
        expect(base.drivers.some((d) => d.standing === "withheld")).toBe(false);
    });

    /**
     * codex review round 2 (CHAOS-4581): `CohortRankingPanel` self-gates
     * away for a `single_subject`-interpreted result even when it carries
     * cohort data (its own rule 0 — `base` is exactly that shape, per
     * `CohortRankingPanel.test.tsx`). Pointing a withheld card at "Ranked
     * teams above" when that panel is not rendering would be a dangling
     * reference — worse than the duplication this was built to close.
     */
    it("shows the full summary (no dangling reference) when Ranked Teams is not rendering", () => {
        expect(base.interpretation.shape).toBe("single_subject");
        expect(base.cohort).not.toBeUndefined();

        render(<DriversPanel result={{ ...base, drivers: [withheldDriver] }} />);

        const card = screen.getByText(withheldDriver.title).closest("li")!;
        const visibleBody = card.querySelector(":scope > .record__body")!;
        expect(visibleBody.textContent).toBe(withheldDriver.summary);
        expect(screen.queryByText(/Ranked teams above/i)).toBeNull();
    });

    /**
     * codex review round 3: `CohortRankingPanel`'s missing-signals footnote
     * is only emitted per RANKED row (`rankingTable`'s own `rows`) — a
     * member that exists in the cohort but was not ranked (named only under
     * "Not ranked by the service: ...") gets no footnote at all, even while
     * the table itself renders for OTHER, ranked members. A withheld driver
     * about that unranked member has nothing to point at.
     */
    it("shows the full summary when the table renders but the driver's own member has no footnote", () => {
        const unrankedMember: CohortMember = {
            subject: { kind: "team", canonical_id: "team:Platform", label: "Platform" },
            rank: 2,
            inclusion_reasons: ["Matched by kind census over the org's team roster."],
            missing_signals: ["workload.forecast_pressure"],
        };
        const resultWithUnranked: InvestigationResult = {
            ...cohortShapedResult,
            cohort: {
                ...cohortShapedResult.cohort!,
                members: [...cohortShapedResult.cohort!.members, unrankedMember],
            },
            drivers: [
                {
                    ...withheldDriver,
                    affected_subjects: [
                        { kind: "team", canonical_id: "team:Platform", label: "Platform" },
                    ],
                },
            ],
        };

        render(<DriversPanel result={resultWithUnranked} />);

        // Sanity: the table IS rendering (a ranked member is present).
        const card = screen.getByText(withheldDriver.title).closest("li")!;
        const visibleBody = card.querySelector(":scope > .record__body")!;
        expect(visibleBody.textContent).toBe(withheldDriver.summary);
        expect(within(card).queryByText(/Ranked teams above/i)).toBeNull();
    });
});
