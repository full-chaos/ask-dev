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
 * CHAOS-4355: a claimed fact's `rows` table renders stacked directly under
 * the answer text (Answer panel), not per-driver and not folded into
 * another section.
 */
describe("DeterministicAnswerView: fact rows panels (CHAOS-4355)", () => {
    it("stacks a fact-rows panel immediately after the Answer panel", () => {
        const result = mockScenarios().find((s) => s.id === "rows")!.result;
        render(<DeterministicAnswerView result={result} />);

        const article = screen.getByRole("article", { name: "Deterministic answer" });
        // CHAOS-4449: the cohort ranking panel is answer content too, and sits
        // between the answer prose and the fact tables when the result carries
        // a ranked cohort. It is excluded here rather than accommodated, so
        // this stays the assertion it has always been — fact rows follow the
        // ANSWER, and are not folded into a later section — instead of
        // becoming an assertion about how many panels precede them.
        const sections = Array.from(article.querySelectorAll("section.panel")).filter(
            (section) => section.getAttribute("aria-labelledby") !== "cohort-ranking-title",
        );
        const answerSectionIndex = sections.findIndex(
            (section) => section.getAttribute("aria-labelledby") === "answer-title",
        );
        expect(answerSectionIndex).toBeGreaterThanOrEqual(0);
        const nextSection = sections[answerSectionIndex + 1]!;
        // CHAOS-4364 pin bump (acr #303, ef303358): the pinned canonical
        // example itself now carries a rows-bearing claimed fact
        // (readiness/release_ready), spread in FIRST by the "rows" scenario
        // (`...result.claimed_facts` before its own CI/metrics additions) —
        // so it, not the CI rollup, is the first stacked panel now.
        expect(nextSection.querySelector(".panel__title")?.textContent).toMatch(
            /readiness.*release ready/i,
        );
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
