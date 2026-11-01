import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerPlanPanel } from "@/components/AnswerPlanPanel";
import type { AnswerPlan } from "@/lib/contracts";

const BASE_PLAN: AnswerPlan = {
    family: "discovered_cohort_ranking",
    family_source: "model_consensus",
    family_version: "question-family.v1",
    require_drivers: true,
    require_ranking: true,
    budget: {
        max_items: 40,
        max_serialized_bytes: 65536,
        max_members: 250,
        synthesis_headroom: 8,
        narrowing_basis: "canonical_id_lexical",
    },
};

/**
 * CHAOS-4636/CHAOS-4668: `answer_plan` is schema-OPTIONAL, so absence must
 * be indistinguishable from this component not existing — no acr sha before
 * S5 (#353) carries it.
 */
describe("AnswerPlanPanel", () => {
    it("renders nothing when the result carries no plan", () => {
        const { container } = render(<AnswerPlanPanel answerPlan={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("is collapsed by default (apparatus, not a lead panel — CHAOS-4669)", () => {
        render(<AnswerPlanPanel answerPlan={BASE_PLAN} />);
        const details = screen.getByTestId("answer-plan-panel");
        expect(details).not.toHaveAttribute("open");
    });

    it("shows the resolved question family in the summary", () => {
        render(<AnswerPlanPanel answerPlan={BASE_PLAN} />);
        expect(screen.getByTestId("answer-plan-panel")).toHaveTextContent(
            "discovered cohort ranking",
        );
    });

    it("shows the budget the plan was built against", () => {
        render(<AnswerPlanPanel answerPlan={BASE_PLAN} />);
        expect(screen.getByTestId("answer-plan-budget")).toHaveTextContent("40 items");
        expect(screen.getByTestId("answer-plan-budget")).toHaveTextContent("250 members");
        expect(screen.getByTestId("answer-plan-budget")).toHaveTextContent("65536 bytes");
    });

    it("shows no narrowing section when the plan narrowed nothing", () => {
        render(<AnswerPlanPanel answerPlan={BASE_PLAN} />);
        expect(screen.queryByTestId("answer-plan-narrowing")).not.toBeInTheDocument();
    });

    /**
     * The "showing 2 of 3 teams" disclosure North Star checks 5/12 ask for —
     * before/after and the basis shown verbatim, never re-derived.
     */
    it("discloses each narrowing step's before/after and basis", () => {
        const plan: AnswerPlan = {
            ...BASE_PLAN,
            narrowing: [
                { stage: "cardinality", basis: "canonical_id_lexical", before: 12, after: 8 },
            ],
        };
        render(<AnswerPlanPanel answerPlan={plan} />);
        const narrowing = screen.getByTestId("answer-plan-narrowing");
        expect(narrowing).toHaveTextContent("Showing 8 of 12");
        expect(narrowing).toHaveTextContent("canonical id lexical");
    });

    it("names the overrun axis when a step recorded one", () => {
        const plan: AnswerPlan = {
            ...BASE_PLAN,
            narrowing: [
                {
                    stage: "assembled_result",
                    basis: "attention_rank",
                    before: 40,
                    after: 30,
                    overrun: "items",
                },
            ],
        };
        render(<AnswerPlanPanel answerPlan={plan} />);
        expect(screen.getByTestId("answer-plan-narrowing")).toHaveTextContent("items");
    });
});
