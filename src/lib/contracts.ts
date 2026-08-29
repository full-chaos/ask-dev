/**
 * Stable names for the generated contract types.
 *
 * The generated modules under src/contracts/generated are rewritten wholesale
 * on every pin bump, and their exported identifiers are derived from the JSON
 * Schema `title` fields, so they are not ours to depend on directly. Every
 * component imports from here instead; a pin bump that renames a generated type
 * is then a one-line change in this file, not a sweep through the UI.
 */
import type {
    AcceptedGrammar,
    ConfirmedStructureEntry,
    EffectiveEvidenceWindow,
    KindOption,
    PriorSubjectReceiptDispositionEntry,
} from "@/contracts/generated/investigation-result";

export type {
    ACRContextFabricInvestigationResultV1 as InvestigationResult,
    AcceptedGrammar,
    AnchorOption,
    CandidateOption,
    ClaimedFact,
    // CHAOS-4355: a claimed fact's OPTIONAL renderable table (CHAOS-4347).
    ClaimedFactRow,
    // CHAOS-4449 (acr CHAOS-4398 PR3/PR3b): the cohort and its ranked members.
    Cohort,
    CohortMember,
    CohortMemberDriver,
    ConfirmedStructureEntry,
    Coverage,
    DriverJudgment,
    Finding,
    HandleOption,
    InterpretedQuestion,
    KindOption,
    PriorSubjectReceiptDispositionEntry,
    RelationshipPath,
    ScalarValue,
    StructureNeeds,
    StructureOfferSnapshotEntry,
    SubjectCandidate,
    SubjectRef,
    SubjectResolution,
    VersionSet,
    WindowClarification,
    WindowOption,
} from "@/contracts/generated/investigation-result";

export type {
    ACRContextFabricInvestigationRequestV1 as InvestigationRequest,
    AnchorBoundReceipt,
    ConversationTurn,
    HandleBoundReceipt,
    KindBoundReceipt,
    WindowBoundReceipt,
} from "@/contracts/generated/investigation-request";

export type { ACRErrorV1 as AcrError } from "@/contracts/generated/error";

/**
 * CHAOS-3927 P2 (pivot-intent design brief §2.1/§2.3). THE SEAM landed: acr
 * commit 7d275c2e (P1 #159, W1 #158, disclosure coverage #160/#161) merged
 * to `main` and the pin bumped past it (`scripts/sync-acr-contracts.mjs`),
 * so `structure_needs`/`confirmed_structure`/etc. are now real, generated
 * fields — see `src/contracts/generated/investigation-result.ts`.
 *
 * The five closed vocabularies P1 introduced (`StructureNeedKind`,
 * `StructureOfferSource`, `StructureSource`, `StructureProvenance`,
 * `StructureDisposition`) and `RelativeWindowID`/`StructureSubjectKind` ride
 * as INLINE literal unions on every field that uses them —
 * json-schema-to-typescript only promotes a `$ref` to its own standalone
 * type when something forces a name, and nothing here does (same as
 * `SubjectRef`/`SubjectCandidate`'s own enums, per that file's own
 * comments). Derived below via indexed access against the generated fields
 * themselves, so there is exactly one source of truth per vocabulary: a
 * pin bump that changes one of these fields moves every alias with it,
 * with no hand-copied literal list to fall out of sync.
 */
export type StructureNeedKind = AcceptedGrammar["member"];
export type StructureOfferSource = KindOption["offer_source"];
export type StructureSource = ConfirmedStructureEntry["source"];
export type StructureProvenance = ConfirmedStructureEntry["provenance"];
export type StructureDisposition = ConfirmedStructureEntry["disposition"];
export type StructureSubjectKind = KindOption["kind"];
/**
 * CHAOS-3478/CHAOS-3813 (acr PR #265, e946ad90): the wire-visible disposition
 * for one `prior_subject_receipts` entry the caller sent. Unlike
 * `StructureDisposition`, a skip here never vetoes the investigation — see
 * `PriorSubjectReceiptDispositionEntry`'s own schema doc comment — so it is
 * disclosed on `SubjectResolution.prior_subject_receipt_dispositions`
 * instead. Derived the same way `StructureDisposition` is above: one source
 * of truth, no hand-copied literal list.
 */
export type PriorSubjectReceiptDisposition = PriorSubjectReceiptDispositionEntry["disposition"];
/**
 * Derived from `EffectiveEvidenceWindow`, NOT `WindowOption` — `WindowOption`'s
 * schema carries `allOf`/`anyOf`/`not` conditionals (the frozen-bounds
 * validation, §5.1) that `json-schema-to-typescript` renders as a deep
 * intersection of index signatures, and indexing into it here blows past
 * TypeScript's type-complexity budget (`TS2590`). `EffectiveEvidenceWindow`
 * declares the identical `relative_id` vocabulary as a plain optional
 * property with none of that conditional structure, so it is the safe
 * source for this one alias.
 */
export type RelativeWindowID = NonNullable<EffectiveEvidenceWindow["relative_id"]>;

/**
 * The four `prior_*_receipts` request fields each pin their OWN generated
 * type (`KindBoundReceipt`/`AnchorBoundReceipt`/`HandleBoundReceipt`/
 * `WindowBoundReceipt`) — same `{result_id, receipt_id}` shape, but each
 * additionally constrains `receipt_id` to its own namespace via a `pattern`
 * TypeScript cannot check structurally. `structure-selections.ts` builds a
 * selection generically (one batch, four members) before it knows which
 * field a receipt is destined for, so it needs ONE shared shape rather than
 * a union of the four — this is that shape, and every generated Bound*Receipt
 * type is structurally assignable to it. The runtime namespace check lives
 * in `structureReceiptHasExpectedNamespace`, not in the type system.
 */
export type BoundStructureReceipt = {
    readonly result_id: string;
    readonly receipt_id: string;
};

/**
 * The closed kindr_/ancr_/handr_/winr_ namespace prefixes (design brief
 * §2.1), matching each generated Bound*Receipt schema's own `pattern`
 * exactly. Not derivable from a TS type (a `pattern` constraint is
 * runtime-only), so hand-kept here, in the one place every consumer reads
 * it from.
 */
export const STRUCTURE_RECEIPT_PREFIX = {
    expected_kind: "kindr_",
    subject_anchor: "ancr_",
    subject_handle: "handr_",
    window: "winr_",
    // CHAOS-4012's own receipt namespace (ContextFabricCandidateOptionReceiptPrefix).
    subject_candidate: "candr_",
} as const satisfies Record<StructureNeedKind, string>;

/**
 * Every member the panel can render an offer for, in elicitation-priority
 * order. `subject_candidate` (CHAOS-4012) is appended last, never
 * reordering the existing four — acr's own
 * ContextFabricStructureNeedSubjectCandidate doc comment: "Appended at the
 * end of the vocabulary, never reordering the existing three."
 */
export const STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER: readonly StructureNeedKind[] = [
    "expected_kind",
    "subject_anchor",
    "subject_handle",
    "window",
    "subject_candidate",
];

/**
 * The four closed vocabularies CHAOS-4398 PR3/PR3b added to `CohortMember`
 * and `CohortMemberDriver`. Derived by indexed access for the same reason
 * the structure vocabularies above are: `json-schema-to-typescript` inlines
 * them rather than naming them, so this is the one place a pin bump that
 * changes one has to be absorbed.
 */
export type CohortMemberOutcome = NonNullable<
    import("@/contracts/generated/investigation-result").CohortMember["outcome"]
>;
export type CohortMemberDataCompleteness = NonNullable<
    import("@/contracts/generated/investigation-result").CohortMember["data_completeness"]
>;
export type CohortDriverSignal =
    import("@/contracts/generated/investigation-result").CohortMemberDriver["signal"];
export type CohortDriverWindow =
    import("@/contracts/generated/investigation-result").CohortMemberDriver["window"];

/** One entry of `coverage.sources`; the contract declares it inline. */
export type CoverageSource =
    import("@/contracts/generated/investigation-result").Coverage["sources"][number];

/** The closed coverage-state vocabulary, as declared by the contract. */
export type CoverageState = CoverageSource["state"];

/** The closed result-status vocabulary, as declared by the contract. */
export type InvestigationStatus =
    import("@/contracts/generated/investigation-result").ACRContextFabricInvestigationResultV1["status"];

/** The closed subject-candidate state vocabulary, as declared by the contract. */
export type SubjectCandidateState =
    import("@/contracts/generated/investigation-result").SubjectCandidate["state"];

/**
 * The closed `ContextFabricSubjectKind` vocabulary as a runtime value
 * (CHAOS-4343 item 3: literal kind nouns in the question bind to
 * `expected_kinds`, which needs a runtime list to validate against — the
 * `StructureSubjectKind` type alone is compile-time only).
 *
 * Keyed via `Record<StructureSubjectKind, true>` rather than a hand-typed
 * array literal: a pin bump that adds or removes a kind changes
 * `StructureSubjectKind`, and `Object.keys` below would silently drift from
 * it if this were a bare array — the `Record` makes that a compile error
 * instead, the same discipline `STRUCTURE_RECEIPT_PREFIX` above already
 * documents for itself.
 */
const SUBJECT_KIND_MEMBERSHIP: Record<StructureSubjectKind, true> = {
    organization: true,
    team: true,
    project: true,
    repository: true,
    work_item: true,
    pull_request: true,
    deployment: true,
    incident: true,
    document: true,
    decision: true,
    episode: true,
    metric: true,
    pull_request_review: true,
    ci_pipeline_run: true,
    work_item_ref: true,
};

export const SUBJECT_KIND_VOCABULARY: readonly StructureSubjectKind[] = Object.keys(
    SUBJECT_KIND_MEMBERSHIP,
) as StructureSubjectKind[];
