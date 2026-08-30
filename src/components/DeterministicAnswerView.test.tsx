import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import type { InvestigationResult } from "@/lib/contracts";
import { mockScenarios } from "@/test/fixtures/investigations";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

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
 * CHAOS-4581: "panels lead" — chris's complaint was that the decision-
 * carrying panels (ranked table, driver contributions, coverage) sat below
 * a wall of prose. These pin the reordering directly: for a single-subject
 * (project-status-shaped) answer, the rows table leads and the prose comes
 * after; for a cohort answer, the ranked-teams panel leads.
 *
 * RED on origin/main: `AnswerPanel` used to render prose immediately, and
 * `FactRowsPanels`/`CohortRankingPanel` came directly under it — both of
 * these orderings fail against that code. GREEN on this branch.
 */
describe("DeterministicAnswerView: panels lead, prose follows (CHAOS-4581)", () => {
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

    it("single-subject: the rows table leads, the drivers/coverage strip follows, prose is last", () => {
        const result = mockScenarios().find((s) => s.id === "rows")!.result;
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        const order = panelOrder(article);
        expect(order.firstFactRows).toBeGreaterThanOrEqual(0);
        expect(order.drivers).toBeGreaterThan(order.firstFactRows);
        expect(order.coverage).toBeGreaterThan(order.firstFactRows);
        expect(order.answer).toBeGreaterThan(order.drivers);
        expect(order.answer).toBeGreaterThan(order.coverage);
        // CHAOS-4364 pin bump (acr #303, ef303358): the pinned canonical
        // example itself carries a rows-bearing claimed fact
        // (readiness/release_ready), spread in FIRST by the "rows" scenario
        // — so it, not the CI rollup, is the first stacked fact-rows panel.
        const sections = Array.from(article.querySelectorAll("section.panel"));
        expect(sections[order.firstFactRows]!.querySelector(".panel__title")?.textContent).toMatch(
            /readiness.*release ready/i,
        );
    });

    it("cohort answer: the ranked-teams panel leads, ahead of drivers/coverage/prose", () => {
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
        expect(order.cohort).toBeGreaterThanOrEqual(0);
        expect(order.drivers).toBeGreaterThan(order.cohort);
        expect(order.coverage).toBeGreaterThan(order.cohort);
        expect(order.answer).toBeGreaterThan(order.drivers);
        expect(order.answer).toBeGreaterThan(order.coverage);
        if (order.firstFactRows >= 0) {
            // CohortRankingPanel is rendered ahead of FactRowsPanels in the
            // view — the ranked-teams panel leads the whole answer, fact
            // tables included, for a cohort-shaped question.
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
    it("cohort answer: applied-selections chip row does not precede Ranked Teams", () => {
        const base = mockScenarios().find((s) => s.id === "complete")!.result;
        expect(base.confirmed_structure?.length).toBeGreaterThan(0);
        const result: InvestigationResult = {
            ...base,
            interpretation: { ...base.interpretation, shape: "discovered_cohort" },
        };
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        expect(screen.getByText("Your selections were applied")).toBeInTheDocument();
        const firstPanel = article.querySelector("section.panel")!;
        expect(firstPanel.getAttribute("data-testid")).toBe("cohort-ranking-panel");
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
