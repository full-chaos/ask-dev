/**
 * The words of an answer's states (CHAOS-12406). There is one render of Ask Dev, so there is one
 * product wording: no raw completeness, source or state value reaches a user on any surface. A
 * value of a closed vocabulary is keyed in a `Record` over its type, so a new member fails
 * typecheck. A value of an open vocabulary has a `string` type, so `answer-copy.test.ts` holds each
 * such table against the schema's documented values, and `labelFor` reads what no table knows.
 *
 * Served prose is not here: an answer, a prompt, a limitation or a reason stays exactly as served.
 *
 * Web's words, copied exactly (change one here only together with web): `ANSWER_STATUS_LABEL`,
 * `QUICK_STATUS_COPY`, `statusLabel`, `COVERAGE_STATE_WORDS`, `COVERAGE_COPY`, `factCountText`,
 * `REQUIREMENT_OUTCOME_WORDS`, `OBLIGATION_LABEL`'s first eight keys, `COHORT_OUTCOME_WORDS`,
 * `RELATIVE_WINDOW_WORDS`, `FACT_KIND_LABEL`, `STANDING_LABEL`,
 * `DERIVATION_LABEL`, `EPISTEMIC_LABEL`, `humanize` and `labelFor`.
 * `SUBJECT_KIND_NOUN` is web's evidence nouns. Every other table holds ask-dev's words, because web
 * shows no such value.
 */
import type {
    AnswerCompleteness,
    AnswerPlan,
    CohortMemberOutcome,
    CoverageSource,
    InvestigationStatus,
    PlanNarrowing,
    PlanRequirementOutcomeRow,
    PriorSubjectReceiptDisposition,
    RelativeWindowID,
    RequirementRefinement,
    StructureDisposition,
} from "../lib/contracts";
import { humanizeTerm, nonBlank } from "../lib/presentation";

/** A value the vocabulary does not know yet, in readable words (open vocabularies). */
export function humanize(value: string): string {
    const words = value.replaceAll("_", " ").trim();
    return words === "" ? value : words.charAt(0).toUpperCase() + words.slice(1);
}

export function labelFor(table: Readonly<Record<string, string>>, value: string): string {
    return Object.hasOwn(table, value) ? (table[value] as string) : humanize(value);
}

/**
 * Check 3 (status ≠ completion ≠ readiness): the result's own status is the state of the ANSWER,
 * never of the work. Each label says "answer", so it cannot read as a project status.
 */
export const ANSWER_STATUS_LABEL: Readonly<Record<InvestigationStatus, string>> = {
    complete: "Full answer",
    partial: "Partial answer",
    degraded: "Degraded answer",
    clarification_required: "Answer needs your confirmation",
    no_match: "No answer: no matching subject",
};

export const QUICK_STATUS_COPY = {
    notFullyCovered: "Answer, not fully covered",
    answer: "Answer",
} as const;

/**
 * The one labelling function for a status. "Full answer" only for a complete status with complete
 * completeness; a complete status is "Answer, not fully covered" beside partial or degraded
 * completeness, and a plain "Answer" when completeness was not derived or is missing. Any other
 * status reads by its label, never raw.
 */
export function statusLabel(
    status: InvestigationStatus,
    completeness: Pick<AnswerCompleteness, "state"> | null | undefined,
): string {
    const served = ANSWER_STATUS_LABEL[status];
    if (status !== "complete") return served;
    const state = completeness?.state;
    if (state === "complete") return served;
    if (state === "partial" || state === "degraded") return QUICK_STATUS_COPY.notFullyCovered;
    return QUICK_STATUS_COPY.answer;
}

/**
 * The derived completeness, as its own badge. Web's reader says these in sentences; this panel
 * keeps the two signals side by side, because they can disagree (D25/B2), so each needs a word.
 */
export const COMPLETENESS_STATE_WORDS: Readonly<Record<AnswerCompleteness["state"], string>> = {
    complete: "Read in full",
    partial: "Read in part",
    degraded: "Some data not available",
    not_derived: "Coverage not known",
};

/** Why an answer stopped short (open vocabulary). */
export const TERMINAL_REASON_WORDS: Readonly<Record<string, string>> = {
    clarification_reason_disclosed: "Ask Dev said why it needs a choice.",
    degraded_reason_disclosed: "Ask Dev said what limits this answer.",
    limitation_disclosed: "Ask Dev named a limitation of this answer.",
    warning_disclosed: "Ask Dev gave a warning about this answer.",
    undisclosed: "Ask Dev gave no reason.",
};

/** What became of one requirement. Never "complete", and unknown stays unknown (check 12). */
export const REQUIREMENT_OUTCOME_WORDS: Readonly<
    Record<PlanRequirementOutcomeRow["outcome"], string>
> = {
    satisfied: "read in full",
    narrowed: "read in part",
    not_applicable: "does not apply",
    not_attempted: "not read: not known",
    unavailable: "not available: not known",
};

/** What the reader loses when a requirement was not met in full. */
export const IMPACT_WORDS: Readonly<Record<PlanRequirementOutcomeRow["impact"], string>> = {
    none: "None",
    scope: "Narrower scope",
    depth: "Less depth",
    dimension: "A missing dimension",
};

/** The ceiling that forced a reduction. */
export const OVERRUN_WORDS: Readonly<Record<NonNullable<PlanNarrowing["overrun"]>, string>> = {
    fits: "fits the limit",
    items: "too many items",
    bytes: "too large",
};

/** The order a narrowing step kept members in. `canonical_id_lexical` is arbitrary on purpose. */
export const NARROWING_BASIS_WORDS: Readonly<Record<PlanNarrowing["basis"], string>> = {
    canonical_id_lexical: "in a fixed order",
    largest_group_round_robin: "in turn from the largest groups",
    attention_rank: "by attention rank",
    overlap_aware_set_cover: "the fewest that cover every group",
    link_strength_then_id: "by link strength",
};

/** When a plan narrowed. */
export const NARROWING_STAGE_WORDS: Readonly<Record<PlanNarrowing["stage"], string>> = {
    cardinality: "before reading facts",
    synthesis_input: "before drafting the answer",
    assembled_result: "after assembling the answer",
};

/** When one reduction of one requirement took place. */
export const REFINEMENT_STAGE_WORDS: Readonly<Record<RequirementRefinement["stage"], string>> = {
    planning: "while planning",
    assembled_result: "after assembling the answer",
    projection: "while shaping the answer",
    reuse: "while reusing an earlier answer",
};

/** The kind of question a plan answers (open vocabulary). */
export const QUESTION_FAMILY_WORDS: Readonly<Record<AnswerPlan["family"], string>> = {
    subject_investigation: "One subject",
    discovered_cohort_ranking: "A ranking",
    scoped_cohort_status: "Status of a group",
    grouped_cohort_status: "Status by group",
    explicit_comparison: "A comparison",
    trend: "A trend",
    investment_allocation: "Investment",
    unclassified: "Not classified",
};

/** What each requirement needed, by obligation (open vocabulary). */
export const OBLIGATION_LABEL: Readonly<Record<string, string>> = {
    state: "Status",
    health: "Health",
    completion: "Completion",
    ranking: "Ranking",
    readiness: "Readiness",
    workload: "Workload",
    investment: "Investment",
    flow: "Flow",
    principal_drivers: "Principal drivers",
    remaining_work: "Remaining work",
    evidence: "Evidence",
    coverage: "Coverage",
    count: "Count",
    allocation_breakdown: "Allocation breakdown",
    trend_series: "Trend series",
    period_delta: "Period change",
};

/**
 * What a requirement row needed: its obligation, else the requirement's first segment. `undefined`
 * when the row names nothing, which a row may do: that is an honest gap, not a blank.
 */
export function requirementLabel(
    row: Pick<PlanRequirementOutcomeRow, "obligation" | "requirement">,
): string | undefined {
    const obligation = row.obligation?.trim() || row.requirement?.split("/")[0]?.trim();
    return obligation === undefined || obligation === ""
        ? undefined
        : labelFor(OBLIGATION_LABEL, obligation);
}

/**
 * The state of a source (open vocabulary). Each documented state has words of its own; `available`
 * is the only one that reads as read.
 */
export const COVERAGE_STATE_WORDS: Readonly<Record<string, string>> = {
    available: "read",
    truncated: "partly included",
    pruned: "not needed for this question",
    stale: "stale",
    no_data: "read: no data (zero rows)",
    not_applicable: "does not apply",
    unavailable: "not available: not known",
    unconfigured: "not set up: not known",
    unauthorized: "not readable with your access: not known",
    conflicted: "sources disagree",
};

/**
 * A source's state in words. A state no table knows takes the label served with it, and otherwise
 * is read as not known, never as read.
 */
export function coverageStateText(source: Pick<CoverageSource, "state" | "state_label">): string {
    const known = Object.hasOwn(COVERAGE_STATE_WORDS, source.state)
        ? COVERAGE_STATE_WORDS[source.state]
        : undefined;
    return (
        known ??
        nonBlank(source.state_label) ??
        `${humanize(source.state).toLowerCase()}: not known`
    );
}

/** The panel headings web has words for. */
export const COVERAGE_COPY = { limitsTitle: "What limits this answer" } as const;

/** How many facts and source rows stand behind the answer; zero is said as zero. */
export function factCountText(
    completeness: Pick<AnswerCompleteness, "claimed_facts_count" | "rows_count">,
): string {
    const facts = completeness.claimed_facts_count;
    const rows = completeness.rows_count;
    if (facts === 0) return "No facts stand behind this answer.";
    const factWord = facts === 1 ? "1 fact" : `${facts.toLocaleString("en-US")} facts`;
    if (rows === 0) return `${factWord}, with no source rows.`;
    const rowWord = rows === 1 ? "1 source row" : `${rows.toLocaleString("en-US")} source rows`;
    return `${factWord} from ${rowWord}.`;
}

/** How far a subject candidate got (open vocabulary). */
export const CANDIDATE_STATE_WORDS: Readonly<Record<string, string>> = {
    committed: "Settled on",
    proposed: "Suggested",
    ambiguous: "Ambiguous",
    unresolved: "Not resolved",
};

/** What became of one carried selection. */
export const STRUCTURE_DISPOSITION_WORDS: Readonly<Record<StructureDisposition, string>> = {
    applied: "Applied",
    vetoed_unresolved: "Not applied: could not be resolved",
    vetoed_conflict: "Not applied: conflicted",
    vetoed_stale: "Not applied: out of date",
    superseded_by_caller: "Replaced by your request",
    not_evaluated: "Not checked this turn",
};

/** How a selection's value entered (open vocabulary). */
export const STRUCTURE_SOURCE_WORDS: Readonly<Record<string, string>> = {
    receipt: "your choice",
    explicit: "stated directly",
    explicit_unattributed: "stated directly, origin not recorded",
    carried: "carried from an earlier turn",
};

/** How firmly a selection's value is known (open vocabulary). */
export const STRUCTURE_PROVENANCE_WORDS: Readonly<Record<string, string>> = {
    inferred_default: "inferred",
    question_stated: "stated in the question",
    clarification_confirmed: "confirmed by you",
    engine_committed: "settled by Ask Dev",
};

/** Where an answer's window came from (open vocabulary). */
export const WINDOW_PROVENANCE_WORDS: Readonly<Record<string, string>> = {
    inferred_default: "Window inferred",
    question_stated: "Stated in the question",
    clarification_confirmed: "Confirmed by you",
    server_default: "Default window",
};

export const RELATIVE_WINDOW_WORDS: Readonly<Record<RelativeWindowID, string>> = {
    trailing_30d: "Last 30 days",
    trailing_90d: "Last 90 days",
    trailing_365d: "Last 365 days",
    all_time: "All time",
};

/** What became of a choice carried from an earlier turn. A skip never stops the investigation. */
export const RECEIPT_DISPOSITION_WORDS: Readonly<Record<PriorSubjectReceiptDisposition, string>> = {
    applied: "Applied",
    skipped_unloadable: "Not applied: the earlier answer could not be read",
    skipped_no_match: "Not applied: it matched no option",
    skipped_stale_graph_epoch: "Not applied: the data has changed since",
    skipped_failed_reauth: "Not applied: your access could not be confirmed",
};

/** Each outcome its own word, so the meaning is never colour alone. */
export const COHORT_OUTCOME_WORDS: Readonly<Record<CohortMemberOutcome, string>> = {
    qualified: "Qualified",
    provisional: "Provisional",
    insufficient_evidence: "Insufficient evidence",
    not_applicable: "Not applicable",
};

/**
 * Fact kinds (a driver's category, a finding's kind; open vocabulary). Status, completion, readiness
 * and health each keep a label of their own (check 3): one is never shown as another.
 */
export const FACT_KIND_LABEL: Readonly<Record<string, string>> = {
    status: "Status",
    actual_completion: "Completion",
    work: "Work",
    blockers: "Blockers",
    reviews: "Reviews",
    continuous_integration: "Continuous integration",
    deployments: "Deployments",
    incidents: "Incidents",
    health: "Health",
    workload: "Workload",
    investment: "Investment",
    readiness: "Readiness",
    operational_deficiency: "Operational deficiency",
    source_health: "Source health",
    relationship: "Relationship",
    narrative: "Narrative",
};

export const STANDING_LABEL: Readonly<Record<string, string>> = {
    principal: "Principal",
    contributing: "Contributing",
    symptom: "Symptom",
    context: "Context",
    withheld: "Withheld",
};

/** Where a driver comes from, in plain words. */
export const DERIVATION_LABEL: Readonly<Record<string, string>> = {
    canonical_structured: "from structured source data",
    deterministic_projection: "computed from source data",
    graph_associated: "linked through the work graph",
    model_extracted: "extracted by AI",
    rule_inferred: "inferred by a rule",
};

/** How sure the source is of a driver. */
export const EPISTEMIC_LABEL: Readonly<Record<string, string>> = {
    observed: "observed",
    source_asserted: "stated by the source",
    inferred: "inferred",
    disputed: "disputed",
    superseded: "superseded",
    unknown: "not known",
};

/** A subject's kind as a noun (open vocabulary). */
export const SUBJECT_KIND_NOUN: Readonly<Record<string, string>> = {
    organization: "organization",
    team: "team",
    project: "project",
    repository: "repository",
    work_item: "work item",
    pull_request: "pull request",
    deployment: "deployment",
    incident: "incident",
    document: "document",
    decision: "decision",
    episode: "episode",
    metric: "metric",
    pull_request_review: "review",
    ci_pipeline_run: "CI run",
    work_item_ref: "work item",
};

export function subjectKindNoun(kind: string): string {
    return Object.hasOwn(SUBJECT_KIND_NOUN, kind)
        ? (SUBJECT_KIND_NOUN[kind] as string)
        : humanizeTerm(kind);
}

const COHORT_KIND_PLURAL: Readonly<Record<string, string>> = {
    team: "teams",
    project: "projects",
    repository: "repositories",
};

/** A cohort's members. A kind this view does not know keeps its noun: never `${kind}s`. */
export function cohortKindPlural(kind: string): string {
    return Object.hasOwn(COHORT_KIND_PLURAL, kind)
        ? (COHORT_KIND_PLURAL[kind] as string)
        : humanizeTerm(kind);
}
