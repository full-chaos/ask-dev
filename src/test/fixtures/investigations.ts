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
    CoverageDetail,
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
        claim_id: "claim_rows_metrics_team_count",
        kind: "metrics",
        // Cites `team_count` (a real scalar sibling field on the same
        // canonical fact, metrics.go's `readProjectMetrics`), never
        // `team_breakdown` itself — `team_breakdown` carries only a Rows
        // value, no scalar, so acr's `SynthesisDraft.ValidateAgainst`
        // (`claim.field`/`claim.value` must equal a real scalar field on the
        // canonical fact it cites) can never produce a claim naming it
        // directly. The rows still attach to this claim regardless —
        // `attachCanonicalRows` copies a canonical fact's one Rows-shaped
        // field onto every claim citing the same (kind, subject) (codex
        // round 2, CHAOS-4364 — this claim predated that PR but shares its
        // fix).
        subject: ASK_DEV_SUBJECT,
        field: "team_count",
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
 *   - `flow`/`team_count` mirrors `devhealthfacts/flow.go`'s `readProjectFlow`
 *     project rollup (`rollup_basis: "team_project_ownership_sum"`,
 *     `items_started`/`items_completed`/`team_count`). The claim cites
 *     `team_count` (a real scalar sibling field on the same canonical fact),
 *     never `team_breakdown` itself — `team_breakdown` carries ONLY a Rows
 *     value (`RowsFactValue`, model.go's `FactValue`), so acr's own
 *     claim-grounding rule (`SynthesisDraft.ValidateAgainst`: `claim.field`/
 *     `claim.value` must equal a real scalar field on the canonical fact it
 *     cites) makes it impossible for a real claim to name it directly
 *     (codex round 1, CHAOS-4364). The rows attach to the claim anyway —
 *     `attachCanonicalRows` copies a canonical fact's one Rows-shaped field
 *     onto every claim citing that same (kind, subject), regardless of which
 *     scalar field the claim names. Per-team rows carry `team_id`/
 *     `items_started`/`items_completed`/`wip_count_end_of_day`/
 *     `bug_completed_ratio`/`story_points_completed`/the WIP-age/cycle/lead
 *     percentiles.
 *   - `landscape`/`team_count` mirrors `devhealthfacts/landscape.go`'s
 *     `readProjectLandscape` project rollup — same claim-grounding shape as
 *     `flow` above (`rollup_basis: "team_project_ownership_landscape"`,
 *     `team_count` as the claim's real scalar field, `team_breakdown` as the
 *     Rows-only sibling attached by (kind, subject)). Per-team rows carry
 *     `team_id`/`map_name`/`as_of_day`/`identity_count`/`churn_loc_30d`/
 *     `delivery_units_30d`/`cycle_p50_30d_hours_avg`/`wip_max_30d`.
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
    // acr's `attachCanonicalRows` (model_runtime.go) attaches a canonical
    // fact's ONE Rows-shaped field to a claim by (kind, subject) match,
    // regardless of which field the claim itself names — and
    // `SynthesisDraft.ValidateAgainst` requires `claim.field`/`claim.value`
    // to equal a REAL scalar sibling field on that same canonical fact
    // (`observed, present := canonical.Fields[claim.Field]`). `team_breakdown`
    // itself carries only `Rows`, no scalar (`RowsFactValue`, model.go's
    // `FactValue`), so a claim can never cite it directly — it must cite
    // `team_count` (or `items_started`/`items_completed`) instead, and the
    // rows arrive attached regardless (codex round 1, CHAOS-4364).
    const flowTeamBreakdown: ClaimedFact = {
        claim_id: "claim_flow_team_count",
        kind: "flow",
        subject: ASK_DEV_SUBJECT,
        field: "team_count",
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
    // Same `attachCanonicalRows`/`ValidateAgainst` shape as `flowTeamBreakdown`
    // above — `team_count` is landscape.go's own scalar sibling of its
    // Rows-shaped `team_breakdown` field.
    const landscapeTeamBreakdown: ClaimedFact = {
        claim_id: "claim_landscape_team_count",
        kind: "landscape",
        subject: ASK_DEV_SUBJECT,
        field: "team_count",
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
 * CHAOS-4690/CHAOS-4691: the `coverage.details[]` entries paired with
 * `degradedScenario`'s own sources/`degraded_reasons`, traced from the real
 * acr producers this ticket's own review read (never invented, CHAOS-2225):
 *   - `applyCoverageDisplayLabels`/`ComposeCoverageDetailLabel`
 *     (`internal/contracts/v1/context_fabric_display_labels.go`) compose
 *     `label` from a detail's own structured fields — `Metrics facts may be
 *     out of date` is `providerReportedLabel("metrics", stale)`;
 *     `Incident facts are not authorized for this account` is
 *     `providerReportedLabel("incident", unauthorized)`; `2 relationship
 *     links could not be resolved` is `countPhrase(2, ...)` for
 *     `graph_endpoint_lookup_failed`; `Workload facts do not apply to what
 *     was asked` is the `fact_pruned` case.
 *   - `cov-metrics-stale` carries no `phrasing` (the Label-floor path:
 *     synthesis MAY phrase a disclosure, and telemetry-observed live runs
 *     show it sometimes does not — CHAOS-4690's Done comment, `absent 0/2`).
 *   - `cov-incidents-unauthorized` carries a `phrasing` (the model DOES
 *     choose to phrase this one) obeying the synthesis guard's own rules
 *     (`internal/contextfabric/chaos4690_synthesis_disclosures*.go`): no
 *     digit (quantities stay the deterministic Label's job) and under the
 *     400-rune bound.
 *   - `raw` on each is the EXACT paired `degraded_reasons`/bare-code entry
 *     `appendFactCoverage`/the graph reader emit (`detail.Raw = degradedEntry`
 *     for a degrading observation) — never re-composed here.
 *   - `cov-workload-pruned` is non-degrading (`factStateDegrades` excludes
 *     `pruned`), so it does not appear in this panel's "Degraded reasons"
 *     list — included anyway for a fixture that mirrors the real shape.
 */
const DEGRADED_SCENARIO_DETAILS: CoverageDetail[] = [
    {
        detail_id: "cov-metrics-stale",
        source: "canonical_fact:metrics",
        code: "fact_provider_reported",
        degrading: true,
        fact_kind: "metrics",
        source_state: "stale",
        label: "Metrics facts may be out of date",
        raw: "metrics: canonical fact capability returned stale",
    },
    {
        detail_id: "cov-incidents-unauthorized",
        source: "canonical_fact:incidents",
        code: "fact_provider_reported",
        degrading: true,
        fact_kind: "incidents",
        source_state: "unauthorized",
        label: "Incident facts are not authorized for this account",
        phrasing: "Incident data wasn't authorized for this account, so it's left out here.",
        raw: "incidents: canonical fact capability returned unauthorized",
    },
    {
        detail_id: "cov-graph-endpoint-lookup-failed",
        source: "context-fabric:graph",
        code: "graph_endpoint_lookup_failed",
        degrading: true,
        count: 2,
        label: "2 relationship links could not be resolved",
        raw: "endpoint_lookup_failed:2",
    },
    {
        detail_id: "cov-workload-pruned",
        source: "canonical_fact:workload",
        code: "fact_pruned",
        degrading: false,
        fact_kind: "workload",
        label: "Workload facts do not apply to what was asked",
        raw: "pruned:subject_kind_unsupported: no resolved subject has a kind this capability supports",
    },
];

/**
 * Coverage that is partial: a stale capability, an unauthorized one, a
 * truncated one, and the pruned one the canonical example already carries.
 * This is the shape the service produces when retrieval loses material —
 * `status: "degraded"`, `coverage.partial: true`, and a `degraded_reasons`
 * entry for each loss.
 *
 * CHAOS-4690/CHAOS-4691: this is the NEW acr shape (post a6414816) — every
 * source carries the engine's own `label`/`state_label`, coverage carries
 * `details[]` (synthesis-phrased where the model chose to phrase, the
 * deterministic Label floor otherwise), and the result carries
 * `evidence_ref_labels`. `degradedLegacyScenario` below is the SAME
 * investigation in the OLD (pre-4690) shape — the ruled exception this
 * pin's consumer code renders via the generic floor, never by parsing.
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
        // CHAOS-4690: one `acr:v1:team:*` id alongside the scenario's own
        // placeholder ids, to exercise the ENGINE-provided
        // `evidence_ref_labels` entry a real `acr:v1:*` ref gets
        // (`ContextFabricEvidenceRefLabel`, traced the same way
        // vocab-mapping.ts's own now-deleted tests were: the exact
        // "acr:v1:team:CHAOS" -> "Team: CHAOS" shape).
        evidence_ref_ids: [
            "evidence_project_identity",
            "evidence_release_acceptance",
            "acr:v1:team:CHAOS",
        ],
        // CHAOS-4690: on a fresh write the key set equals the result's own
        // evidence-ref closure exactly (schema doc comment) — every id
        // above, including the two placeholder ones (which fall through to
        // the engine's OWN generic "Evidence" floor, same as a consumer
        // never seeing them would, since they carry no `acr:v1:*` shape).
        evidence_ref_labels: {
            evidence_project_identity: "Evidence",
            evidence_release_acceptance: "Evidence",
            "acr:v1:team:CHAOS": "Team: CHAOS",
        },
        deterministic_answer:
            "Two projects are slipping. Coverage is partial, so treat the ranking between them as provisional.",
        coverage: {
            sources: [
                {
                    source: "dev-health-ops:status",
                    state: "available",
                    observed_at: "2026-08-11T16:00:02Z",
                    watermark: "status-wm-42",
                    label: "Dev Health — status",
                    state_label: "available",
                },
                {
                    source: "canonical_fact:metrics",
                    state: "stale",
                    observed_at: "2026-08-09T04:12:00Z",
                    watermark: "metrics-wm-11",
                    reason: "canonical fact capability returned stale",
                    label: "Canonical facts — metrics",
                    state_label: "may be out of date",
                },
                {
                    source: "canonical_fact:incidents",
                    state: "unauthorized",
                    reason: "canonical fact capability returned unauthorized",
                    label: "Canonical facts — incident",
                    state_label: "not authorized",
                },
                {
                    source: "context-fabric:graph",
                    state: "truncated",
                    observed_at: "2026-08-11T16:00:02Z",
                    reason: "canonical fact capability returned truncated",
                    label: "Relationship graph",
                    state_label: "partially included",
                },
                {
                    source: "canonical_fact:workload",
                    state: "pruned",
                    reason: "pruned:subject_kind_unsupported: no resolved subject has a kind this capability supports",
                    label: "Canonical facts — workload",
                    state_label: "not needed",
                },
            ],
            partial: true,
            degraded_reasons: [
                "endpoint_lookup_failed:2",
                "incidents: canonical fact capability returned unauthorized",
                "metrics: canonical fact capability returned stale",
            ],
            // CHAOS-4690/CHAOS-4691: the structured replacement for the
            // consumer-side sentence tables this ticket deletes — see
            // `DEGRADED_SCENARIO_DETAILS`'s own doc comment for provenance.
            // `degraded_reasons` above still ships (item 5 of the pin delta:
            // "unchanged — ignore, never parse") — the renderer reads
            // `details` instead whenever it is present.
            details: DEGRADED_SCENARIO_DETAILS,
        },
        limitations: [
            "Metric evidence is stale, so slippage magnitude is not current.",
            "Incident evidence was not readable under this principal's authorization scope.",
        ],
        warnings: ["Coverage is partial; treat the ranking as provisional."],
    };
}

/**
 * CHAOS-4691's ruled legacy-stored-result exception (pin delta item 6): the
 * SAME investigation as `degradedScenario`, in the OLD (pre-CHAOS-4690) acr
 * shape — an immutable result stored before the engine-phrasing rollout.
 * `coverage.details` is ABSENT (not `[]`), no source carries `label`/
 * `state_label`, and the result carries no `evidence_ref_labels` at all.
 * The pinned schema (this same pin bump) must accept this shape without
 * requiring the new fields — that both-shapes tolerance is the CHAOS-4656
 * deploy-safety doctrine this pin exists to prove — and the renderer must
 * fall through to the deterministic generic floor for every one of them,
 * never reconstruct the old sentence-table behavior by parsing the raw
 * strings that are still, correctly, all this shape carries.
 */
function degradedLegacyScenario(): InvestigationResult {
    const newShape = degradedScenario();
    // `_evidenceRefLabels` is deliberately dropped: this scenario predates
    // evidence_ref_labels entirely (see this function's own doc comment).
    const { evidence_ref_labels: _evidenceRefLabels, ...legacyBase } = newShape;
    return {
        ...legacyBase,
        result_id: "result_degraded_legacy_0001",
        request_id: "request_degraded_legacy_0001",
        question: "Which projects were slipping, and how confident could we be in that?",
        evidence_ref_ids: newShape.evidence_ref_ids.filter((id) => id !== "acr:v1:team:CHAOS"),
        coverage: {
            sources: newShape.coverage.sources.map((source) => {
                const legacySource = { ...source };
                delete legacySource.label;
                delete legacySource.state_label;
                return legacySource;
            }),
            partial: newShape.coverage.partial,
            degraded_reasons: newShape.coverage.degraded_reasons ?? [],
            // `details` intentionally OMITTED (not an empty array) — this is
            // the legacy-shape discriminator itself; see this function's own
            // doc comment.
        },
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
            demonstrates:
                "Partial coverage (NEW acr shape, CHAOS-4690): stale, unauthorized, truncated, and pruned sources, engine-provided source labels, coverage.details[] with synthesis phrasing and the deterministic Label floor, and evidence_ref_labels.",
            result: degradedScenario(),
        },
        {
            id: "degraded-legacy",
            question: "Which projects were slipping, and how confident could we be in that?",
            demonstrates:
                "CHAOS-4691's ruled legacy-stored-result exception: the SAME investigation in the OLD (pre-4690) acr shape -- no coverage.details, no source labels, no evidence_ref_labels -- rendered via the deterministic generic floor, never reconstructed by parsing.",
            result: degradedLegacyScenario(),
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
