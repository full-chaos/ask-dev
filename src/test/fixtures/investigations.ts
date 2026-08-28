/**
 * Mock investigation results, DERIVED from the pinned canonical example.
 *
 * House rule (CHAOS-2225): mocks mirror the real backend vocabulary. Nothing
 * here is invented. Every scenario starts as a structural clone of
 * `contracts/examples/v1/context_fabric_investigation_result.v1.json` at the
 * pinned acr commit and then overrides named fields with values drawn from the
 * contract's own closed vocabularies, or with strings the ACR service itself
 * produces:
 *
 *   - `coverage.sources[].state`  — the closed SourceObservation enum.
 *   - `status`                    — the closed result-status enum.
 *   - `subject_resolution.candidates[].state` — the closed SubjectCandidate enum.
 *   - source names                — `dev-health-ops:<capability>`,
 *                                   `canonical_fact:<kind>`, `context-fabric:graph`.
 *   - the prune reason            — `pruned:subject_kind_unsupported: ...`,
 *                                   the ONLY prune reason the fact planner emits.
 *   - degraded_reasons entries    — `"<fact kind>: <reason>"` from
 *                                   appendFactCoverage, and `endpoint_lookup_failed:<n>`
 *                                   from the graph reader.
 *
 * A vocabulary term that does not appear in the contract must not appear here.
 * `src/mocks/investigations.test.ts` proves that by validating every scenario
 * against the pinned JSON Schemas, with a negative control that rejects an
 * invented coverage state.
 */
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type {
    ClaimedFact,
    ConfirmedStructureEntry,
    InvestigationResult,
    SubjectRef,
} from "@/lib/contracts";

/**
 * The canonical example, unmodified. Structurally cloned on every read so a
 * component (or a test) can never mutate the shared fixture.
 */
function canonical(): InvestigationResult {
    return structuredClone(canonicalResult) as unknown as InvestigationResult;
}

/**
 * Subjects reused across scenarios. `ASK_DEV_SUBJECT` is the canonical
 * example's own subject, copied field for field.
 */
const ASK_DEV_SUBJECT: SubjectRef = {
    kind: "project",
    canonical_id: "project_ask_dev",
    label: "Ask Dev",
};

const ATLAS_PROJECT_SUBJECT: SubjectRef = {
    kind: "project",
    canonical_id: "project_atlas",
    label: "Atlas",
};

const ASK_DEV_REPOSITORY_SUBJECT: SubjectRef = {
    kind: "repository",
    canonical_id: "repository:repo_ask_dev",
    label: "full-chaos/ask-dev",
};

export type MockScenario = {
    /** Stable id used by tests and the scenario picker. */
    readonly id: string;
    /** The question this scenario answers. */
    readonly question: string;
    /** What this scenario exists to exercise in the renderer. */
    readonly demonstrates: string;
    readonly result: InvestigationResult;
};

function completeScenario(): InvestigationResult {
    return canonical();
}

/**
 * CHAOS-4355: exercises `ClaimedFact.rows` (CHAOS-4347, additive on acr main
 * @ 30f38869) — NOT YET produced by a live investigation as of this
 * scenario's authoring (hop 5's synthesis routing is in flight on a sibling
 * lane), so this is a fixture/mock walkthrough, not a live one. Field names
 * are drawn from the real producers, not invented (CHAOS-2225): the CI daily
 * rollup shape mirrors `devhealthfacts/ci.go`'s `readRepositoryAggregate`
 * (`day`/`pipelines_count`/`success_rate`), and the project metrics rollup
 * mirrors `devhealthfacts/metrics.go`'s `readProjectMetrics`
 * (`rollup_basis: "team_project_ownership_sum"` as a SIBLING claim next to
 * the `team_breakdown` rows claim, `team_name`/`day`/`commits_count`/
 * `after_hours_commit_ratio`/`weekend_commit_ratio`).
 *
 * Three shapes, one of each renderer path:
 *   - `continuous_integration`/`pipelines_count` — time axis (`day`) +
 *     two numeric columns -> multi-series LINE chart with a legend.
 *   - `metrics`/`team_breakdown` — ordinal axis (`team_name`) + numeric
 *     columns -> BAR chart, caption shows the sibling `rollup_basis`.
 *   - `metrics`/`latency_percentiles` — every column numeric, no axis
 *     candidate at all -> falls back to the TABLE renderer.
 */
function rowsScenario(): InvestigationResult {
    const result = canonical();
    const ciRollup: ClaimedFact = {
        claim_id: "claim_rows_ci_daily",
        kind: "continuous_integration",
        subject: ASK_DEV_REPOSITORY_SUBJECT,
        field: "pipelines_count",
        value: { integer: 42 },
        rows: [
            {
                fields: {
                    day: { string: "2026-08-20" },
                    pipelines_count: { integer: 38 },
                    success_rate: { number: 0.86 },
                },
            },
            {
                fields: {
                    day: { string: "2026-08-21" },
                    pipelines_count: { integer: 41 },
                    success_rate: { number: 0.9 },
                },
            },
            {
                fields: {
                    day: { string: "2026-08-22" },
                    pipelines_count: { integer: 42 },
                    success_rate: { number: 0.88 },
                },
            },
        ],
    };
    const teamRollupBasis: ClaimedFact = {
        claim_id: "claim_rows_metrics_basis",
        kind: "metrics",
        subject: ASK_DEV_SUBJECT,
        field: "rollup_basis",
        value: { string: "team_project_ownership_sum" },
    };
    const teamBreakdown: ClaimedFact = {
        claim_id: "claim_rows_metrics_breakdown",
        kind: "metrics",
        subject: ASK_DEV_SUBJECT,
        field: "team_breakdown",
        value: { integer: 2 },
        // Field order mirrors the real wire shape: acr's Go
        // `encoding/json` marshals a `map[string]FactValue` in SORTED key
        // order, so `team_id` reaches the client BEFORE `team_name`
        // (codex round 1, CHAOS-4355) — the renderer must still prefer the
        // readable name as the chart axis, never the opaque id.
        rows: [
            {
                fields: {
                    after_hours_commit_ratio: { number: 0.18 },
                    commits_count: { integer: 61 },
                    day: { string: "2026-08-22" },
                    team_id: { string: "team_platform_9f2a" },
                    team_name: { string: "Platform" },
                    weekend_commit_ratio: { number: 0.07 },
                },
            },
            {
                fields: {
                    after_hours_commit_ratio: { number: 0.29 },
                    commits_count: { integer: 24 },
                    day: { string: "2026-08-22" },
                    team_id: { string: "team_growth_c410" },
                    team_name: { string: "Growth" },
                    weekend_commit_ratio: { number: 0.12 },
                },
            },
        ],
    };
    const latencyTable: ClaimedFact = {
        claim_id: "claim_rows_latency_percentiles",
        kind: "metrics",
        subject: ASK_DEV_REPOSITORY_SUBJECT,
        field: "latency_percentiles",
        value: { number: 340 },
        rows: [
            {
                fields: {
                    p50_duration_minutes: { number: 12.4 },
                    p90_duration_minutes: { number: 28.1 },
                    p99_duration_minutes: { number: 55.6 },
                },
            },
        ],
    };
    return {
        ...result,
        result_id: "result_rows_0001",
        request_id: "request_rows_0001",
        question: "How has full-chaos/ask-dev's CI and team investment looked this week?",
        deterministic_answer:
            "full-chaos/ask-dev's CI has held steady this week, and its metrics rollup carries a per-team breakdown alongside the project total.",
        direct_judgment:
            "CI and delivery metrics are stable, with no single team dominating investment.",
        current_state:
            "Pipeline success rate has stayed in the high 80s over the last three days; the Platform and Growth teams both contributed commits this week.",
        claimed_facts: [
            ...result.claimed_facts,
            ciRollup,
            teamRollupBasis,
            teamBreakdown,
            latencyTable,
        ],
    };
}

/**
 * CHAOS-4364 (acr #307, 56316ebe): exercises the `flow` and `landscape`
 * FactKinds and a `carried` (not `receipt`) `confirmed_structure` source —
 * the live shape ACR's pinned commit b8350816 emits on a multi-turn
 * ask -> clarify -> confirm flow (cf-question-results.md "20:46 08-27
 * CHAOS-4355 live proof rev 20"). That live proof got `outcome=success`,
 * `claims=4`, `rows_count=5` from ACR itself but the Workbench's OWN Ajv
 * validation rejected the response as `acr_contract_violation` because the
 * pin predates both additions — this scenario is that shape, structurally
 * cloned from the producers' own field names (never invented, CHAOS-2225):
 *
 *   - `flow`/`team_breakdown` mirrors `devhealthfacts/flow.go`'s
 *     `readProjectFlow` project rollup (`rollup_basis:
 *     "team_project_ownership_sum"`, `items_started`/`items_completed`/
 *     `team_count`, per-team rows carrying `team_id`/`items_started`/
 *     `items_completed`/`wip_count_end_of_day`/`bug_completed_ratio`/
 *     `story_points_completed`/the WIP-age/cycle/lead percentiles).
 *   - `landscape`/`team_breakdown` mirrors `devhealthfacts/landscape.go`'s
 *     `readProjectLandscape` project rollup (`rollup_basis:
 *     "team_project_ownership_landscape"`, per-team rows carrying
 *     `team_id`/`map_name`/`as_of_day`/`identity_count`/`churn_loc_30d`/
 *     `delivery_units_30d`/`cycle_p50_30d_hours_avg`/`wip_max_30d`).
 *   - `confirmed_structure` carries one `receipt`-sourced `expected_kind`
 *     entry (the ordinary carried-kind shape) AND one `carried`-sourced
 *     `window` entry — acr #306 (02c44254)'s same-conversation window carry,
 *     which requires `prior_result_id` and forbids `receipt_id` (unlike
 *     every other source, which requires neither or the opposite pairing).
 */
function flowLandscapeScenario(): InvestigationResult {
    const result = canonical();
    const confirmedStructure: [ConfirmedStructureEntry, ConfirmedStructureEntry] = [
        {
            member: "expected_kind",
            applied_value: "project",
            source: "receipt",
            prior_result_id: "result_prior_flow_0001",
            receipt_id: "kindr_flow_9012",
            provenance: "clarification_confirmed",
            disposition: "applied",
        },
        {
            member: "window",
            applied_value: "trailing_90d",
            source: "carried",
            prior_result_id: "result_prior_flow_0001",
            provenance: "clarification_confirmed",
            disposition: "applied",
        },
    ];
    const flowRollupBasis: ClaimedFact = {
        claim_id: "claim_flow_rollup_basis",
        kind: "flow",
        subject: ASK_DEV_SUBJECT,
        field: "rollup_basis",
        value: { string: "team_project_ownership_sum" },
    };
    const flowTeamBreakdown: ClaimedFact = {
        claim_id: "claim_flow_team_breakdown",
        kind: "flow",
        subject: ASK_DEV_SUBJECT,
        field: "team_breakdown",
        value: { integer: 2 },
        rows: [
            {
                fields: {
                    team_id: { string: "team_platform_9f2a" },
                    items_started: { integer: 14 },
                    items_completed: { integer: 11 },
                    wip_count_end_of_day: { integer: 6 },
                    wip_age_p50_hours: { number: 18.4 },
                    cycle_time_p50_hours: { number: 22.1 },
                    lead_time_p50_hours: { number: 40.7 },
                    bug_completed_ratio: { number: 0.18 },
                    story_points_completed: { number: 23 },
                },
            },
            {
                fields: {
                    team_id: { string: "team_growth_c410" },
                    items_started: { integer: 9 },
                    items_completed: { integer: 7 },
                    wip_count_end_of_day: { integer: 4 },
                    wip_age_p50_hours: { number: 21.2 },
                    cycle_time_p50_hours: { number: 26.5 },
                    lead_time_p50_hours: { number: 48.3 },
                    bug_completed_ratio: { number: 0.11 },
                    story_points_completed: { number: 15 },
                },
            },
        ],
    };
    const landscapeRollupBasis: ClaimedFact = {
        claim_id: "claim_landscape_rollup_basis",
        kind: "landscape",
        subject: ASK_DEV_SUBJECT,
        field: "rollup_basis",
        value: { string: "team_project_ownership_landscape" },
    };
    const landscapeTeamBreakdown: ClaimedFact = {
        claim_id: "claim_landscape_team_breakdown",
        kind: "landscape",
        subject: ASK_DEV_SUBJECT,
        field: "team_breakdown",
        value: { integer: 2 },
        rows: [
            {
                fields: {
                    team_id: { string: "team_platform_9f2a" },
                    map_name: { string: "churn_throughput" },
                    as_of_day: { string: "2026-08-26" },
                    identity_count: { integer: 5 },
                    churn_loc_30d: { integer: 18420 },
                    delivery_units_30d: { integer: 61 },
                    cycle_p50_30d_hours_avg: { number: 24.6 },
                    wip_max_30d: { integer: 9 },
                },
            },
            {
                fields: {
                    team_id: { string: "team_growth_c410" },
                    map_name: { string: "churn_throughput" },
                    as_of_day: { string: "2026-08-26" },
                    identity_count: { integer: 3 },
                    churn_loc_30d: { integer: 9310 },
                    delivery_units_30d: { integer: 34 },
                    cycle_p50_30d_hours_avg: { number: 29.8 },
                    wip_max_30d: { integer: 5 },
                },
            },
        ],
    };
    return {
        ...result,
        result_id: "result_flow_landscape_0001",
        request_id: "request_flow_landscape_0001",
        question: "What's the delivery flow and IC landscape picture for Ask Dev right now?",
        deterministic_answer:
            "Ask Dev's delivery flow is steady across both owning teams, and the IC landscape shows no team concentrated at the WIP ceiling.",
        direct_judgment:
            "Flow and landscape signals are both healthy; no team is carrying disproportionate churn or WIP.",
        current_state:
            "Both owning teams completed most of what they started this window, and 30-day churn/throughput stays within the normal band for each.",
        claimed_facts: [
            ...result.claimed_facts,
            flowRollupBasis,
            flowTeamBreakdown,
            landscapeRollupBasis,
            landscapeTeamBreakdown,
        ],
        confirmed_structure: confirmedStructure,
    };
}

/**
 * Coverage that is partial: a stale capability, an unauthorized one, a
 * truncated one, and the pruned one the canonical example already carries.
 * This is the shape the service produces when retrieval loses material —
 * `status: "degraded"`, `coverage.partial: true`, and a `degraded_reasons`
 * entry for each loss.
 */
function degradedScenario(): InvestigationResult {
    const result = canonical();
    return {
        ...result,
        result_id: "result_degraded_0001",
        request_id: "request_degraded_0001",
        status: "degraded",
        question: "Which projects are slipping, and how confident can we be in that?",
        interpretation: {
            ...result.interpretation,
            shape: "discovered_cohort",
            requested_judgment: "slippage_and_confidence",
            subject_terms: [],
            fact_requirements: [
                { kind: "status", subjects: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT] },
                { kind: "metrics", subjects: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT] },
                { kind: "incidents", subjects: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT] },
            ],
        },
        subject_resolution: {
            candidates: [
                {
                    receipt_id: "receipt_degraded_ask_dev",
                    subject: ASK_DEV_SUBJECT,
                    state: "committed",
                    matched_terms: [],
                    match_reasons: ["Discovered by cohort expansion over active projects."],
                    confidence: 1.0,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
                {
                    receipt_id: "receipt_degraded_atlas",
                    subject: ATLAS_PROJECT_SUBJECT,
                    state: "committed",
                    matched_terms: [],
                    match_reasons: ["Discovered by cohort expansion over active projects."],
                    confidence: 1.0,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
            ],
            committed: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT],
        },
        direct_judgment:
            "Two projects are slipping, but the ranking between them is not trustworthy on this evidence.",
        current_state:
            "Status evidence is current for both projects, while the metric evidence behind slippage magnitude is two days stale.",
        strongest_pressures: [
            "Release acceptance remains incomplete.",
            "Slippage magnitude rests on stale metric evidence.",
        ],
        drivers: [
            {
                driver_id: "driver_degraded_0001",
                standing: "principal",
                category: "readiness",
                title: "Release acceptance remains incomplete",
                summary:
                    "Neither project can be treated as ready until the required acceptance path succeeds.",
                affected_subjects: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT],
                evidence_ref_ids: ["evidence_release_acceptance"],
                derivation: "canonical_structured",
                epistemic_status: "observed",
                confidence: 0.94,
                current: true,
            },
            {
                driver_id: "driver_degraded_0002",
                standing: "contributing",
                category: "source_health",
                title: "Metric evidence is stale",
                summary:
                    "The metrics capability last reported two days ago, so slippage magnitude cannot be ranked with confidence.",
                affected_subjects: [ASK_DEV_SUBJECT, ATLAS_PROJECT_SUBJECT],
                evidence_ref_ids: ["evidence_project_identity"],
                derivation: "rule_inferred",
                epistemic_status: "inferred",
                confidence: 0.71,
                qualification: "This driver describes the evidence, not the projects.",
                current: true,
            },
        ],
        remaining_work: [],
        readiness_gaps: [],
        paths: [],
        conflicts: [],
        claimed_facts: [],
        evidence_ref_ids: ["evidence_project_identity", "evidence_release_acceptance"],
        deterministic_answer:
            "Two projects are slipping. Coverage is partial, so treat the ranking between them as provisional.",
        coverage: {
            sources: [
                {
                    source: "dev-health-ops:status",
                    state: "available",
                    observed_at: "2026-08-11T16:00:02Z",
                    watermark: "status-wm-42",
                },
                {
                    source: "canonical_fact:metrics",
                    state: "stale",
                    observed_at: "2026-08-09T04:12:00Z",
                    watermark: "metrics-wm-11",
                    reason: "canonical fact capability returned stale",
                },
                {
                    source: "canonical_fact:incidents",
                    state: "unauthorized",
                    reason: "canonical fact capability returned unauthorized",
                },
                {
                    source: "context-fabric:graph",
                    state: "truncated",
                    observed_at: "2026-08-11T16:00:02Z",
                    reason: "canonical fact capability returned truncated",
                },
                {
                    source: "canonical_fact:workload",
                    state: "pruned",
                    reason: "pruned:subject_kind_unsupported: no resolved subject has a kind this capability supports",
                },
            ],
            partial: true,
            degraded_reasons: [
                "endpoint_lookup_failed:2",
                "incidents: canonical fact capability returned unauthorized",
                "metrics: canonical fact capability returned stale",
            ],
        },
        limitations: [
            "Metric evidence is stale, so slippage magnitude is not current.",
            "Incident evidence was not readable under this principal's authorization scope.",
        ],
        warnings: ["Coverage is partial; treat the ranking as provisional."],
    };
}

/**
 * Two candidates share the subject term, so nothing is committed and the
 * service asks for a choice. `direct_judgment` is empty on purpose: the
 * contract only requires a non-empty judgment for `complete` and `partial`,
 * and a service that has not resolved a subject has no judgment to give.
 */
function clarificationScenario(): InvestigationResult {
    const result = canonical();
    return {
        ...result,
        result_id: "result_clarify_0001",
        request_id: "request_clarify_0001",
        status: "clarification_required",
        question: "Is Atlas on track?",
        interpretation: {
            ...result.interpretation,
            shape: "single_subject",
            requested_judgment: "release_readiness_and_current_drivers",
            subject_terms: ["Atlas"],
            clarification_needed: true,
            clarification_reason: "The term “Atlas” matches more than one canonical subject.",
        },
        subject_resolution: {
            candidates: [
                {
                    receipt_id: "receipt_atlas_project",
                    subject: ATLAS_PROJECT_SUBJECT,
                    state: "ambiguous",
                    matched_terms: ["Atlas"],
                    match_reasons: ["Exact canonical project label."],
                    confidence: 0.62,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
                {
                    receipt_id: "receipt_atlas_repository",
                    subject: {
                        kind: "repository",
                        canonical_id: "repository:repo_atlas",
                        label: "full-chaos/atlas",
                    },
                    state: "ambiguous",
                    matched_terms: ["Atlas"],
                    match_reasons: ["Repository name matches the subject term."],
                    confidence: 0.41,
                    evidence_ref_ids: ["evidence_project_identity"],
                },
            ],
            committed: [],
            clarification_prompt:
                "Did you mean the Atlas project or the full-chaos/atlas repository?",
        },
        direct_judgment: "",
        current_state: "",
        strongest_pressures: [],
        drivers: [],
        remaining_work: [],
        readiness_gaps: [],
        paths: [],
        conflicts: [],
        claimed_facts: [],
        limitations: ["No judgment was formed because the subject is unresolved."],
        deterministic_answer: "The subject is ambiguous, so no judgment was formed.",
        warnings: [],
    };
}

/** Nothing in the graph answers the question. */
function noMatchScenario(): InvestigationResult {
    const result = canonical();
    return {
        ...result,
        result_id: "result_nomatch_0001",
        request_id: "request_nomatch_0001",
        status: "no_match",
        question: "How is the Voyager rewrite going?",
        interpretation: {
            ...result.interpretation,
            subject_terms: ["Voyager rewrite"],
            fact_requirements: [],
            clarification_needed: false,
        },
        subject_resolution: { candidates: [], committed: [] },
        direct_judgment: "",
        current_state: "",
        strongest_pressures: [],
        drivers: [],
        remaining_work: [],
        readiness_gaps: [],
        paths: [],
        conflicts: [],
        claimed_facts: [],
        evidence_ref_ids: [],
        limitations: ["No canonical subject matched the question's terms."],
        coverage: {
            sources: [
                {
                    source: "dev-health-ops:status",
                    state: "no_data",
                    observed_at: "2026-08-11T16:00:02Z",
                    reason: "canonical fact capability returned no_data",
                },
            ],
            partial: false,
            degraded_reasons: [],
        },
        deterministic_answer: "No canonical subject matched this question.",
        warnings: [],
    };
}

export function mockScenarios(): readonly MockScenario[] {
    return [
        {
            id: "complete",
            question: canonicalResult.question,
            demonstrates: "Canonical example: full judgment, drivers, evidence, one pruned source.",
            result: completeScenario(),
        },
        {
            id: "rows",
            question: "How has full-chaos/ask-dev's CI and team investment looked this week?",
            demonstrates:
                "Claimed facts carrying rows (CHAOS-4347): a time-axis line chart, an ordinal bar chart with a rollup_basis caption, and an all-numeric fallback table.",
            result: rowsScenario(),
        },
        {
            id: "flow-landscape",
            question: "What's the delivery flow and IC landscape picture for Ask Dev right now?",
            demonstrates:
                "CHAOS-4364 flow/landscape FactKinds with rows, plus a carried (not receipt) confirmed_structure source (acr #306/#307).",
            result: flowLandscapeScenario(),
        },
        {
            id: "degraded",
            question: "Which projects are slipping, and how confident can we be in that?",
            demonstrates: "Partial coverage: stale, unauthorized, truncated, and pruned sources.",
            result: degradedScenario(),
        },
        {
            id: "clarification",
            question: "Is Atlas on track?",
            demonstrates: "Ambiguous subject: candidates offered, nothing committed.",
            result: clarificationScenario(),
        },
        {
            id: "no-match",
            question: "How is the Voyager rewrite going?",
            demonstrates: "No canonical subject matched the question.",
            result: noMatchScenario(),
        },
    ];
}

/**
 * Picks the scenario whose question best matches what was asked.
 *
 * Deliberately dumb — it is a fixture router, not a search feature. An exact
 * (case-insensitive) question match wins; anything else falls back to the
 * canonical example so the renderer always has something contract-shaped to
 * draw.
 */
export function resolveMockScenario(question: string): MockScenario {
    const normalized = question.trim().toLowerCase();
    const scenarios = mockScenarios();
    const matched = scenarios.find(
        (scenario) => scenario.question.toLowerCase() === normalized || scenario.id === normalized,
    );
    return matched ?? scenarios[0]!;
}
