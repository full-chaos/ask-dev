import type { AnswerProjection } from "./contracts";

/** What ACR's bounded answer says it cut (`context_fabric_answer_projection.v1`, CHAOS-12559). */
export type ProjectionBudget = AnswerProjection["projection_budget"];

/**
 * Every count of content a bounded answer left out, in the order the left-out line names them.
 * `values_clamped` is not here: it counts values that were shortened, not left out.
 */
export const OMISSION_COUNTS = [
    "drivers_omitted",
    "withheld_drivers_omitted",
    "cohort_members_omitted",
    "cohort_groups_omitted",
    "facts_omitted",
    "candidates_omitted",
    "evidence_refs_omitted",
    "limitations_omitted",
    "warnings_omitted",
    "coverage_omitted",
    "reasons_omitted",
    "render_shapes_omitted",
] as const satisfies readonly (keyof ProjectionBudget)[];

export type OmissionCount = (typeof OMISSION_COUNTS)[number];

/**
 * ACR's own rule for the budget (acr `validate_context_fabric_answer_projection.go`): `truncated` is
 * true if and only if a count (an omission or `values_clamped`) is above zero or
 * `full_result_omitted` is set. The JSON Schema cannot state a rule across fields, so the classifier
 * checks it: a budget that breaks it cannot be told apart from a complete answer, or says an
 * answer was shortened when nothing was cut.
 */
export function budgetIsConsistent(budget: ProjectionBudget): boolean {
    const cut =
        budget.full_result_omitted ||
        (budget.values_clamped ?? 0) > 0 ||
        OMISSION_COUNTS.some((key) => (budget[key] ?? 0) > 0);
    return budget.truncated === cut;
}
