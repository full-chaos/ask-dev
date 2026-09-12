import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import unsupportedExample from "@/contracts/examples/context_fabric_investigation_result_unsupported.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";
import { visibleText } from "@/test/visible-text";

/**
 * codex finding (CHAOS-4171 PR3, chaos4171pr3-codex-r1): the clarification
 * branch renders `ClarificationPanel`, not `SubjectResolutionPanel` — so
 * `SubjectResolution.prior_subject_receipt_dispositions` disclosure was
 * silently dropped on exactly the result shape most likely to carry it: a
 * caller re-asks with a prior subject receipt, the receipt is skipped, AND
 * the fresh question is itself still ambiguous. Fixed by rendering
 * `PriorSubjectReceiptDisclosure` directly in both branches.
 */
describe("DeterministicAnswerView: prior-subject-receipt disclosure on the clarification path", () => {
    function clarificationResultWithDroppedReceipt(): InvestigationResult {
        const base = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
        return {
            ...base,
            subject_resolution: {
                ...base.subject_resolution,
                prior_subject_receipt_dispositions: [
                    {
                        prior_result_id: "result_prior_0001",
                        receipt_id: "subr_0001",
                        disposition: "skipped_stale_graph_epoch",
                    },
                ],
            },
        };
    }

    it("renders the disclosure even when the result is clarification_required", () => {
        const result = clarificationResultWithDroppedReceipt();
        expect(result.status).toBe("clarification_required");

        render(<DeterministicAnswerView result={result} />);

        expect(
            screen.getByRole("heading", { name: "Prior-turn subject receipts" }),
        ).toBeInTheDocument();
        expect(screen.getByText("subr_0001")).toBeInTheDocument();
        expect(screen.getByText("skipped stale graph epoch")).toBeInTheDocument();
        // The candidate list itself still comes from ClarificationPanel, not
        // a duplicated SubjectResolutionPanel (no `onChooseCandidate` here,
        // so ClarificationPanel's own read-only heading applies).
        expect(screen.getByRole("heading", { name: "Subject candidates" })).toBeInTheDocument();
    });

    it("renders nothing extra when the result carries no prior-receipt dispositions", () => {
        const base = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
        render(<DeterministicAnswerView result={base} />);

        expect(screen.queryByRole("heading", { name: "Prior-turn subject receipts" })).toBeNull();
    });
});

/**
 * CHAOS-4581 established "panels lead, prose follows" against a wall of
 * prose; CHAOS-4669 refines it (does not reverse it, per that ticket's own
 * header): the ANSWER — short by construction, see `AnswerPanel`'s own doc
 * comment — leads INTO the charts, and the evidence/driver/computation
 * apparatus collapses behind it. Order: answer summary -> rich charts ->
 * collapsed evidence. `AnswerPanel` itself is still the FIRST content
 * panel, same "panels lead" BAR CHAOS-4581 set, because the answer block
 * IS the lead panel (CHAOS-4669 acceptance) — this is not prose reading as
 * a wall ahead of the panels, it is one short paragraph immediately
 * followed by them.
 *
 * RED on origin/main pre-CHAOS-4669: `AnswerPanel` rendered AFTER the
 * ranked table / driver cards / coverage strip. GREEN on this branch.
 */
describe("DeterministicAnswerView: answer leads into the charts (CHAOS-4581/CHAOS-4669)", () => {
    function panelOrder(article: HTMLElement) {
        const sections = Array.from(article.querySelectorAll("section.panel"));
        return {
            firstFactRows: sections.findIndex((s) =>
                (s.getAttribute("aria-labelledby") ?? "").startsWith("fact-rows-"),
            ),
            cohort: sections.findIndex(
                (s) => s.getAttribute("data-testid") === "cohort-ranking-panel",
            ),
            drivers: sections.findIndex((s) => s.getAttribute("data-testid") === "drivers-panel"),
            coverage: sections.findIndex((s) => s.getAttribute("data-testid") === "coverage-panel"),
            answer: sections.findIndex((s) => s.getAttribute("data-testid") === "answer-panel"),
        };
    }

    it("single-subject: the answer leads, then the rows table, then the drivers/coverage strip", () => {
        const result = mockScenarios().find((s) => s.id === "rows")!.result;
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const order = panelOrder(article);
        expect(order.answer).toBe(0);
        expect(order.firstFactRows).toBeGreaterThan(order.answer);
        expect(order.drivers).toBeGreaterThan(order.firstFactRows);
        expect(order.coverage).toBeGreaterThan(order.firstFactRows);
        // CHAOS-4364 pin bump (acr #303, ef303358): the pinned canonical
        // example itself carries a rows-bearing claimed fact
        // (readiness/release_ready), spread in FIRST by the "rows" scenario
        // — so it, not the CI rollup, is the first stacked fact-rows panel.
        const sections = Array.from(article.querySelectorAll("section.panel"));
        expect(sections[order.firstFactRows]!.querySelector(".panel__title")?.textContent).toMatch(
            /readiness.*release ready/i,
        );
    });

    it("cohort answer: the answer leads, then the ranked-teams panel leads the charts, ahead of drivers/coverage", () => {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        // The pinned canonical example carries a real ranked cohort but is
        // interpreted `single_subject` (CohortRankingPanel's own rule 0
        // pins that this combination happens) — override the shape here so
        // the panel actually renders, isolating the ordering question from
        // the intent gate CohortRankingPanel.test.tsx already covers.
        const result: InvestigationResult = {
            ...base,
            interpretation: { ...base.interpretation, shape: "discovered_cohort" },
        };
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const order = panelOrder(article);
        expect(order.answer).toBe(0);
        expect(order.cohort).toBeGreaterThan(order.answer);
        expect(order.drivers).toBeGreaterThan(order.cohort);
        expect(order.coverage).toBeGreaterThan(order.cohort);
        if (order.firstFactRows >= 0) {
            // CohortRankingPanel is rendered ahead of FactRowsPanels in the
            // view — the ranked-teams panel leads the charts, fact tables
            // included, for a cohort-shaped question.
            expect(order.firstFactRows).toBeGreaterThan(order.cohort);
        }
    });

    /**
     * codex review round 3: the ticket specifies "RANKED TEAMS ... THEN
     * principal driver cards" for a cohort answer — Drivers must immediately
     * follow Ranked Teams, not just "somewhere after" it. The prior test
     * only pinned relative ordering (cohort < drivers < answer), which a
     * cohort-then-fact-rows-then-drivers sequence also satisfies; this pins
     * the literal adjacency using the SAME scenario (cohort + a real
     * rows-bearing fact) codex's own repro used.
     */
    it("cohort answer: Drivers immediately follows Ranked Teams, before any fact-rows panel", () => {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        expect(base.claimed_facts.some((fact) => fact.rows !== undefined)).toBe(true);
        const result: InvestigationResult = {
            ...base,
            interpretation: { ...base.interpretation, shape: "discovered_cohort" },
        };
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const sections = Array.from(article.querySelectorAll("section.panel"));
        const cohortIndex = sections.findIndex(
            (s) => s.getAttribute("data-testid") === "cohort-ranking-panel",
        );
        const nextSection = sections[cohortIndex + 1]!;
        expect(nextSection.getAttribute("data-testid")).toBe("drivers-panel");
    });

    /**
     * codex review round 1: the "Your selections were applied" chip row
     * (`StructureConfirmationNotice`) used to render ahead of everything,
     * including Ranked Teams — provenance outranking the panel it was
     * supposed to lead with. The pinned canonical example carries BOTH a
     * real cohort AND `confirmed_structure`, so this is the exact scenario
     * codex flagged, not a constructed one.
     */
    it("cohort answer: applied-selections chip row does not precede Ranked Teams (nor the answer)", () => {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        expect(base.confirmed_structure?.length).toBeGreaterThan(0);
        const result: InvestigationResult = {
            ...base,
            interpretation: { ...base.interpretation, shape: "discovered_cohort" },
        };
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const chipRowHeading = screen.getByRole("heading", {
            name: "Your selections were applied",
        });
        const sections = Array.from(article.querySelectorAll("section.panel"));
        const chipRowIndex = sections.findIndex((s) => s.contains(chipRowHeading));
        const cohortIndex = sections.findIndex(
            (s) => s.getAttribute("data-testid") === "cohort-ranking-panel",
        );
        const answerIndex = sections.findIndex(
            (s) => s.getAttribute("data-testid") === "answer-panel",
        );
        expect(chipRowIndex).toBeGreaterThan(cohortIndex);
        expect(chipRowIndex).toBeGreaterThan(answerIndex);
        // CHAOS-4669: the answer itself is the true lead panel now.
        expect(answerIndex).toBe(0);
    });

    it("renders no fact-rows panel for a result whose claimed facts carry no rows", () => {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        // CHAOS-4364 pin bump: the pinned canonical example ("complete")
        // itself now carries one rows-bearing fact (readiness/release_ready,
        // acr #303), so this drops it rather than using "complete" as-is —
        // the assertion is about the no-rows case, not about that one fact.
        const result: InvestigationResult = {
            ...base,
            claimed_facts: base.claimed_facts.filter((fact) => fact.rows === undefined),
        };
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        // Scoped to the fact-rows panels by their own heading ids (CHAOS-4449):
        // `.fact-table-wrap` is a shared table style, and the cohort ranking
        // panel reuses it, so querying the class alone would make this assert
        // "no table of any kind" — a claim this test never meant to make.
        expect(article.querySelector('section[aria-labelledby^="fact-rows-"]')).toBeNull();
        expect(article.querySelector(".fact-chart")).toBeNull();
    });
});

/**
 * codex review round 2 (CHAOS-4581): extracting the clarification branch's
 * inline Limitations block into the shared `LimitationsPanel` component also
 * surfaces `result.warnings` there for the first time (the old inline copy
 * never rendered them). Deliberate — `warnings` is unconditional on the
 * result type, not gated by status, and informational only — so this is a
 * closed gap, not scope creep; pinned here rather than left an ARGUED
 * finding.
 */
describe("DeterministicAnswerView: clarification branch shows warnings too (codex round 2, CHAOS-4581)", () => {
    it("renders result.warnings on a clarification_required result", () => {
        const base = structureMockScenarios().find((s) => s.id === "structure-kind")!.result;
        const result: InvestigationResult = {
            ...base,
            warnings: ["The cohort ranking is provisional."],
        };
        expect(result.status).toBe("clarification_required");
        render(<DeterministicAnswerView result={result} />);

        expect(screen.getByRole("heading", { name: "Warnings" })).toBeInTheDocument();
        expect(screen.getByText("The cohort ranking is provisional.")).toBeInTheDocument();
    });
});

/**
 * acr #504: the empty form. An UNSUPPORTED terminal result (degraded, no
 * facts, no evidence) carries `deterministic_answer: ""`; what the service
 * could not support is disclosed in `limitations` and `coverage`, not in an
 * answer sentence. Rendered from acr's own example, the view shows that
 * disclosure and no blank answer line -- the empty string never renders as
 * an empty headline pretending to be an answer.
 *
 * Every claim below is made against `visibleText`, not `toHaveTextContent`:
 * jsdom's `textContent` counts the body of a CLOSED `<details>`, so an
 * assertion written against it cannot tell a disclosed sentence from a
 * collapsed one. What is on screen and what is merely reachable are asserted
 * separately, each as itself.
 */
describe("DeterministicAnswerView: the unsupported result's empty answer renders as disclosure, not a blank answer (acr #504)", () => {
    it("shows the limitation and the degraded source, and no answer sentence line", () => {
        const result = unsupportedExample as unknown as InvestigationResult;
        expect(result.status).toBe("degraded");
        expect(result.deterministic_answer).toBe("");
        expect(result.claimed_facts).toHaveLength(0);
        expect(result.evidence_ref_ids).toHaveLength(0);

        render(<DeterministicAnswerView result={result} />);

        const answer = screen.getByTestId("answer-panel");
        expect(answer.querySelector(".answer__judgment")).toBeNull();
        expect(visibleText(answer)).toContain("The service returned no direct judgment.");

        expect(screen.getByRole("heading", { name: "Limitations" })).toBeInTheDocument();
        const limitations = screen
            .getByRole("heading", { name: "Limitations" })
            .closest("section")!;
        expect(visibleText(limitations)).toContain(result.limitations[0]!);

        const coverage = screen.getByTestId("coverage-panel");
        expect(visibleText(coverage)).toContain("Degraded reasons");
        // The headline must not claim completeness while the only source is
        // `unavailable` -- acr's example is `partial: false`, so before the
        // sibling fix in CoveragePanel this panel said "Complete - every
        // source contributed." beside its own degraded-reason list.
        expect(visibleText(coverage)).toContain("Partial — some sources did not contribute.");
        expect(visibleText(coverage)).not.toContain("Complete — every source contributed.");
        // The non-contributing source and its state ARE on screen, on the chip.
        expect(visibleText(coverage)).toContain("unavailable");
    });

    /**
     * The reason the non-complete headline is reporting is ON SCREEN, not one
     * click away. acr's example carries the legacy `degraded_reasons[]` shape
     * (no `coverage.details`), whose raw string is the only reason text there
     * is — so it is what shows, and nothing is left to collapse. This is the
     * end-to-end form of the invariant: a reader who never opens a
     * disclosure still learns WHY the answer was withheld.
     */
    it("shows the concrete degraded reason on screen, with nothing left behind a disclosure", () => {
        const result = unsupportedExample as unknown as InvestigationResult;
        render(<DeterministicAnswerView result={result} />);

        const coverage = screen.getByTestId("coverage-panel");
        const reason = unsupportedExample.coverage.degraded_reasons[0]!;

        expect(visibleText(coverage)).toContain(reason);
        expect(visibleText(coverage)).not.toContain(
            "This source didn't fully contribute; no reason was reported.",
        );
        expect(within(coverage).queryAllByTestId("degraded-reason-raw")).toEqual([]);
    });

    /**
     * The whole visible disclosure, as one string, so a future change that
     * quietly drops any part of it fails here rather than passing three
     * narrower assertions. This is what the tester actually reads for an
     * unsupported answer.
     */
    it("the visible page states the gap: no answer, a non-complete headline, the state, the reason, the limitation", () => {
        const result = unsupportedExample as unknown as InvestigationResult;
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const visible = visibleText(article);
        expect(visible).toContain("The service returned no direct judgment.");
        expect(visible).toContain("Partial — some sources did not contribute.");
        expect(visible).toContain("unavailable");
        expect(visible).toContain(unsupportedExample.coverage.degraded_reasons[0]!);
        expect(visible).toContain(result.limitations[0]!);
        expect(visible).not.toContain("Complete — every source contributed.");
    });
});

/**
 * The last hop of the user-visible path for a continuation the service refused:
 * the result's own limitation sentence is what the tester reads, so it must be
 * VISIBLE — not merely present in the DOM behind a disclosure. The refusal basis
 * itself is a machine field the view does not render; what must survive to the
 * screen is the sentence the service wrote about it.
 */
describe("DeterministicAnswerView: a refused continuation still shows the service's own limitation", () => {
    function refusedContinuation(): InvestigationResult {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        return {
            ...structuredClone(base),
            refusal_basis: "continuation_context_unverifiable",
            limitations: [
                "The previous turn's context could not be verified, so this answer covers the requested window only.",
            ],
        } as unknown as InvestigationResult;
    }

    it("renders the limitation as visible text", () => {
        const result = refusedContinuation();
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        expect(visibleText(article)).toContain(result.limitations[0]!);
        expect(screen.getByRole("heading", { name: "Limitations" })).toBeInTheDocument();
    });

    it("renders the same way with the basis absent — the view does not key off it", () => {
        const withBasis = refusedContinuation();
        const withoutBasis = structuredClone(withBasis) as unknown as Record<string, unknown>;
        delete withoutBasis.refusal_basis;

        const a = render(<DeterministicAnswerView result={withBasis} />);
        const withText = visibleText(
            a.container.querySelector('article[aria-label="Deterministic answer"]')!,
        );
        a.unmount();
        const b = render(
            <DeterministicAnswerView result={withoutBasis as unknown as InvestigationResult} />,
        );
        const withoutText = visibleText(
            b.container.querySelector('article[aria-label="Deterministic answer"]')!,
        );
        expect(withText).toBe(withoutText);
    });
});
