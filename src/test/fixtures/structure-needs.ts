/**
 * Mock StructureNeeds/ConfirmedStructure results (CHAOS-3927 P2, design
 * brief §2.1/§2.2).
 *
 * THE SEAM landed (acr 7d275c2e; `@/lib/contracts`'s own header):
 * `structure_needs` is now a real field on the pinned contract, verified —
 * `grep -c structure_needs
 * src/contracts/schemas/context_fabric_investigation_result.v1.schema.json`
 * reads 2. These scenarios extend `@/test/fixtures/investigations`' own
 * real, pinned-schema-valid scenarios with the P1(+W1) blocks, whose values
 * are drawn ONLY from the pinned contract's own closed vocabularies
 * (SubjectKind, StructureNeedKind, RelativeWindowID, StructureDisposition,
 * ...) — mirrors `investigations.ts`'s own house rule (CHAOS-2225): nothing
 * here is invented, everything is a value the closed vocabulary actually
 * contains.
 *
 * Validated directly against the pinned contract
 * (`context_fabric_investigation_result.v1.schema.json`) by
 * `structure-needs.test.ts`, with the same negative-control discipline
 * `investigations.test.ts` applies elsewhere.
 */
import { mockScenarios } from "@/test/fixtures/investigations";
import type {
    AnchorOption,
    ConfirmedStructureEntry,
    HandleOption,
    InvestigationResult,
    KindOption,
    StructureNeeds,
    WindowOption,
} from "@/lib/contracts";

function baseScenario(id: string): InvestigationResult {
    const scenario = mockScenarios().find((entry) => entry.id === id);
    if (scenario === undefined) throw new Error(`unknown base scenario: ${id}`);
    return structuredClone(scenario.result);
}

const KIND_OPTIONS: readonly KindOption[] = [
    {
        receipt_id: "kindr_ci_pipeline_run_0001",
        option_id: "kind_ci_pipeline_run",
        label: "CI pipeline run",
        kind: "ci_pipeline_run",
        offer_source: "engine",
    },
    {
        receipt_id: "kindr_pull_request_0001",
        option_id: "kind_pull_request",
        label: "Pull request",
        kind: "pull_request",
        offer_source: "engine",
    },
];

const ANCHOR_OPTIONS: readonly AnchorOption[] = [
    {
        receipt_id: "ancr_repo_atlas_0001",
        option_id: "anchor_repo_atlas",
        label: "full-chaos/atlas",
        kind: "repository",
        canonical_id: "repository:repo_atlas",
        // 24 lowercase hex chars exactly — the pinned schema's own
        // AnchorOption.matched_term_hash bound (minLength/maxLength 24,
        // `^[0-9a-f]{24}$`). This fixture originally carried a 64-char
        // sha256 hex digest (P2 shipped provisionally, before the field's
        // real shape was committed acr-side) — corrected once THE SEAM
        // landed and the real bound became readable from the pinned schema.
        matched_term_hash: "a1b2c3d4e5f6a7b8c9d0e1f2",
        offer_source: "engine",
    },
];

const HANDLE_OPTIONS: readonly HandleOption[] = [
    {
        receipt_id: "handr_pr_number_0001",
        option_id: "handle_pr_412",
        label: "PR #412",
        kind: "pull_request",
        pattern_id: "pr_number",
        value: "412",
        source_column: "pull_requests.number",
        offer_source: "engine",
    },
];

const WINDOW_OPTIONS: readonly WindowOption[] = [
    {
        receipt_id: "winr_trailing_30d_0001",
        option_id: "window_trailing_30d",
        label: "Last 30 days",
        relative_id: "trailing_30d",
        start: "2026-07-20T00:00:00Z",
        end: "2026-08-19T00:00:00Z",
    },
    {
        receipt_id: "winr_all_time_0001",
        option_id: "window_all_time",
        label: "All time",
        relative_id: "all_time",
    },
];

/**
 * Kind disambiguation (design brief §1.2 reading 1: "the cheapest,
 * highest-leverage elicitation" — 30/41 stalled pools are multi-kind).
 * `no_discriminators` refusal, no subject candidates: interpretation could
 * not even settle which census to run.
 */
function kindDisambiguationScenario(): InvestigationResult {
    const result = baseScenario("no-match");
    // The cast is the ordinary `readonly T[]` → `T[]` one `@/lib/acr/client.ts`
    // documents on its own `receipts` cast: the generated field is a plain
    // mutable array, and every option constant above is declared `readonly`.
    const structureNeeds: StructureNeeds = {
        missing: ["expected_kind"],
        kind_options: KIND_OPTIONS as NonNullable<StructureNeeds["kind_options"]>,
        accepted_grammars: [{ member: "expected_kind", pattern_id: "expected_kind_enum" }],
    };
    return {
        ...result,
        result_id: "result_structure_kind_0001",
        request_id: "request_structure_kind_0001",
        question: "How's the pipeline doing?",
        status: "clarification_required",
        structure_needs: structureNeeds,
    };
}

/** Anchor + window: "the universal manageability pair" (§1.2 reading 2). */
function anchorAndWindowScenario(): InvestigationResult {
    const result = baseScenario("no-match");
    const structureNeeds: StructureNeeds = {
        missing: ["subject_anchor", "window"],
        anchor_options: ANCHOR_OPTIONS as NonNullable<StructureNeeds["anchor_options"]>,
        window_options: WINDOW_OPTIONS as NonNullable<StructureNeeds["window_options"]>,
    };
    return {
        ...result,
        result_id: "result_structure_anchor_window_0001",
        request_id: "request_structure_anchor_window_0001",
        question: "How many PRs merged?",
        status: "clarification_required",
        structure_needs: structureNeeds,
    };
}

/** Handle offer: a grammar-valid value arrived explicit_unattributed and the engine offers it back. */
function handleOfferScenario(): InvestigationResult {
    const result = baseScenario("no-match");
    const structureNeeds: StructureNeeds = {
        missing: ["subject_handle"],
        handle_options: HANDLE_OPTIONS as NonNullable<StructureNeeds["handle_options"]>,
        accepted_grammars: [
            { member: "subject_handle", kind: "pull_request", pattern_id: "pr_number" },
        ],
    };
    return {
        ...result,
        result_id: "result_structure_handle_0001",
        request_id: "request_structure_handle_0001",
        question: "What's the status of PR 412?",
        status: "clarification_required",
        structure_needs: structureNeeds,
    };
}

/**
 * The confirmed_structure echo, all applied — a decisive result reached via
 * confirmation (§2.1's B5: decisive results carry the offer context too).
 */
function appliedConfirmationScenario(): InvestigationResult {
    const result = baseScenario("complete");
    const confirmedStructure: readonly ConfirmedStructureEntry[] = [
        {
            member: "expected_kind",
            applied_value: "pull_request",
            source: "receipt",
            prior_result_id: "result_structure_kind_0001",
            receipt_id: "kindr_pull_request_0001",
            offer_source: "engine",
            provenance: "clarification_confirmed",
            disposition: "applied",
        },
        {
            member: "window",
            applied_value: "trailing_30d",
            source: "receipt",
            prior_result_id: "result_structure_anchor_window_0001",
            receipt_id: "winr_trailing_30d_0001",
            offer_source: "engine",
            provenance: "clarification_confirmed",
            disposition: "applied",
        },
    ];
    return {
        ...result,
        result_id: "result_structure_applied_0001",
        request_id: "request_structure_applied_0001",
        confirmed_structure: confirmedStructure as NonNullable<
            InvestigationResult["confirmed_structure"]
        >,
    };
}

/**
 * The silent-drop closure itself (§2.1): one applied, one vetoed. A fresh
 * clarification, not an answer — a batch veto terminates
 * `structure_confirmation_conflict` (§2.5), so the round returns fresh
 * offers rather than a decisive result.
 */
function vetoedConfirmationScenario(): InvestigationResult {
    const result = baseScenario("no-match");
    const confirmedStructure: readonly ConfirmedStructureEntry[] = [
        {
            member: "expected_kind",
            applied_value: "pull_request",
            source: "receipt",
            prior_result_id: "result_structure_kind_0001",
            receipt_id: "kindr_pull_request_0001",
            offer_source: "engine",
            provenance: "clarification_confirmed",
            disposition: "applied",
        },
        {
            member: "subject_anchor",
            applied_value: "repository:repo_atlas",
            source: "receipt",
            prior_result_id: "result_structure_anchor_window_0001",
            receipt_id: "ancr_repo_atlas_0001",
            offer_source: "engine",
            provenance: "clarification_confirmed",
            disposition: "vetoed_stale",
        },
    ];
    const structureNeeds: StructureNeeds = {
        missing: ["subject_anchor"],
        anchor_options: ANCHOR_OPTIONS as NonNullable<StructureNeeds["anchor_options"]>,
    };
    return {
        ...result,
        result_id: "result_structure_vetoed_0001",
        request_id: "request_structure_vetoed_0001",
        question: "How many PRs merged?",
        status: "clarification_required",
        structure_needs: structureNeeds,
        confirmed_structure: confirmedStructure as NonNullable<
            InvestigationResult["confirmed_structure"]
        >,
    };
}

/**
 * NEVER-ELICIT control (§1.3): an aggregate-classed disclosure never carries
 * subject_anchor/subject_handle — engine-side by construction, not a panel
 * special case. Kept as a fixture so a regression that started offering
 * anchor/handle for an aggregate question would show up here first.
 */
function aggregateClassNeverElicitScenario(): InvestigationResult {
    const result = baseScenario("degraded");
    const structureNeeds: StructureNeeds = {
        missing: ["window"],
        window_options: WINDOW_OPTIONS as NonNullable<StructureNeeds["window_options"]>,
    };
    return {
        ...result,
        result_id: "result_structure_aggregate_0001",
        request_id: "request_structure_aggregate_0001",
        structure_needs: structureNeeds,
    };
}

export type StructureMockScenario = {
    readonly id: string;
    readonly demonstrates: string;
    readonly result: InvestigationResult;
};

export function structureMockScenarios(): readonly StructureMockScenario[] {
    return [
        {
            id: "structure-kind",
            demonstrates: "Kind disambiguation: the cheapest, highest-leverage elicitation.",
            result: kindDisambiguationScenario(),
        },
        {
            id: "structure-anchor-window",
            demonstrates: "Anchor + window: the universal manageability pair.",
            result: anchorAndWindowScenario(),
        },
        {
            id: "structure-handle",
            demonstrates: "A grammar-valid handle offered back for one-turn confirmation.",
            result: handleOfferScenario(),
        },
        {
            id: "structure-applied",
            demonstrates: "confirmed_structure, every carried member applied.",
            result: appliedConfirmationScenario(),
        },
        {
            id: "structure-vetoed",
            demonstrates:
                "confirmed_structure, one applied and one vetoed — the silent-drop closure.",
            result: vetoedConfirmationScenario(),
        },
        {
            id: "structure-aggregate-never-elicit",
            demonstrates: "Aggregate-classed disclosure never carries anchor/handle offers.",
            result: aggregateClassNeverElicitScenario(),
        },
    ];
}
