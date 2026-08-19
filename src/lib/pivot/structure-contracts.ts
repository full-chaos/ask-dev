/**
 * StructureNeeds / ConfirmedStructure contract types (CHAOS-3927 P2, the
 * pivot-intent design brief, DESIGN-FINAL — §2.1/§2.3).
 *
 * PENDING-P1, HAND-MIRRORED — NOT a synced contract artifact. Read this
 * whole comment before touching anything in this file.
 *
 * `pnpm acr:contracts:generate` regenerates `src/contracts/**` from ONE
 * pinned acr commit (see `src/contracts/manifest.json`), and that commit
 * predates CHAOS-3900 P1 (StructureNeeds/kind/anchor/handle) and W1
 * (window) entirely — neither `structure_needs` nor `window_clarification`
 * exists anywhere under `src/contracts/`, verified: `grep -c
 * "structure_needs\|window_clarification"
 * src/contracts/schemas/context_fabric_investigation_result.v1.schema.json`
 * reads 0. P1 is mid-build in a parallel lane (acr branch `chaos-pivot-p1`,
 * not yet merged to acr `main`), so there is nothing to sync FROM yet.
 *
 * These types are copied field-for-field from the P1 lane's OWN committed
 * source of record, not invented:
 *   - Go types:    acr `internal/contracts/v1/context_fabric_structure_types.go`
 *                  (branch chaos-pivot-p1, commit de7b6d45 "P1: StructureNeeds
 *                  contract-type layer")
 *   - JSON Schema: acr `contracts/jsonschema/v1/context_fabric_common.v1.schema.json`
 *                  `$defs`: StructureNeedKind, StructureOfferSource,
 *                  StructureSource, StructureProvenance, StructureDisposition,
 *                  KindOption, AnchorOption, HandleOption, AcceptedGrammar,
 *                  StructureNeeds, ConfirmedStructureEntry,
 *                  StructureOfferSnapshotEntry, KindBoundReceipt,
 *                  AnchorBoundReceipt, HandleBoundReceipt, WindowOption,
 *                  WindowClarification, WindowBoundReceipt, RelativeWindowID,
 *                  SubjectKind (same branch/commit; window rides CHAOS-3900 W1,
 *                  already merged into that same branch).
 *   - Request fields: acr `internal/contracts/v1/context_fabric_types.go`
 *                  `ContextFabricInvestigationRequest.PriorKindReceipts` /
 *                  `.PriorAnchorReceipts` / `.PriorHandleReceipts` /
 *                  `.PriorWindowReceipts`.
 *   - Result field:   `ContextFabricInvestigationResult.StructureNeeds` /
 *                  `.ConfirmedStructure` / `.StructureOfferSnapshot` /
 *                  `.WindowClarification`.
 * A staging copy of the relevant JSON Schema `$defs` (used only to validate
 * this repo's OWN fixtures, never a real ACR response) lives beside this
 * file at `./structure-needs.pending-p1.schema.json`.
 *
 * ============================== THE SEAM ==============================
 * When P1 (+ W1) merge to acr `main` and the ask-dev contract pin bumps
 * past that merge (README.md "Bumping the pin"), the regenerated
 * `src/contracts/generated/investigation-{request,result}.ts` will declare
 * every type below itself. At that point:
 *   1. Delete this file and its sibling schema.
 *   2. In `src/lib/contracts.ts`, re-point every re-export below at
 *      `@/contracts/generated/investigation-result` /
 *      `-request` instead of `@/lib/pivot/structure-contracts`.
 *   3. In `src/lib/acr/client.ts`, delete the
 *      `InvestigationRequestWithStructureReceipts` widening type and change
 *      `buildInvestigationRequest`'s return type and `satisfies` clause back
 *      to plain `InvestigationRequest` (the four `prior_*_receipts` fields
 *      will already be legal on that type).
 * No other file changes: every consumer (`StructureNeedsPanel`,
 * `StructureConfirmationNotice`, `structure-selections.ts`,
 * `structure-disposition.ts`, the investigations route) imports these names
 * through `@/lib/contracts`/`@/lib/acr/client`, never from this file
 * directly, so the rename above is the ENTIRE migration.
 * ========================================================================
 */

/** Mirrors acr's ContextFabricSubjectKind (registry-pinned, closed). */
export type StructureSubjectKind =
    | "organization"
    | "team"
    | "project"
    | "repository"
    | "work_item"
    | "pull_request"
    | "deployment"
    | "incident"
    | "document"
    | "decision"
    | "episode"
    | "metric"
    | "pull_request_review"
    | "ci_pipeline_run"
    | "work_item_ref";

/**
 * Which intent-frame member is missing or ambiguous (design brief §2.1).
 * `relation_family` and `cohort_shape` are UNREPRESENTABLE here by design
 * (§1.1 demotion) — the wire enum has no members for them, so no surface,
 * including this one, can offer or elicit either.
 */
export type StructureNeedKind = "expected_kind" | "subject_anchor" | "subject_handle" | "window";

/** Distinguishes an engine-derived offer from a Bridge-proposed one (§2.1/§2.4). */
export type StructureOfferSource = "engine" | "prior";

/** How a `ConfirmedStructureEntry`'s value entered — the WIRE MECHANISM. */
export type StructureSource = "receipt" | "explicit" | "explicit_unattributed";

/** The §2.0 authority tier a `ConfirmedStructureEntry` actually carries. */
export type StructureProvenance =
    "inferred_default" | "question_stated" | "clarification_confirmed";

/**
 * What happened to one carried structure member (§2.1's silent-drop
 * closure: "a veto the caller cannot see is the silent drop reborn").
 */
export type StructureDisposition =
    "applied" | "vetoed_unresolved" | "vetoed_conflict" | "vetoed_stale";

/** The closed relative-window-id registry (CHAOS-3900 W1, §5.1). */
export type RelativeWindowID = "trailing_30d" | "trailing_90d" | "trailing_365d" | "all_time";

type StructureOfferProvenanceFields = {
    readonly offer_source: StructureOfferSource;
    readonly prior_version_id?: string;
    readonly prior_entry_id?: string;
};

/** One server-offered census-kind choice, confirmable via a `kindr_` receipt. */
export type KindOption = StructureOfferProvenanceFields & {
    readonly receipt_id: string;
    readonly option_id: string;
    readonly label: string;
    readonly kind: StructureSubjectKind;
};

/**
 * One server-offered unique-claimant anchor candidate, confirmable via an
 * `ancr_` receipt. `claimant_key` is the identity-registry v2 key
 * (org-scoped, opaque, no display text — the 3859 sink discipline applied
 * to offers) and is never shown; it exists only to round-trip in the
 * receipt.
 */
export type AnchorOption = StructureOfferProvenanceFields & {
    readonly receipt_id: string;
    readonly option_id: string;
    readonly label: string;
    readonly kind: StructureSubjectKind;
    readonly canonical_id: string;
    readonly claimant_key: string;
};

/**
 * One server-offered grammar-valid handle candidate, confirmable via a
 * `handr_` receipt (v4/sol-r3 #2: handles get the full symmetric transport).
 */
export type HandleOption = StructureOfferProvenanceFields & {
    readonly receipt_id: string;
    readonly option_id: string;
    readonly label: string;
    readonly kind: StructureSubjectKind;
    readonly pattern_id: string;
    readonly value: string;
    readonly source_column: string;
};

/** One server-offered evidence-window choice (CHAOS-3900 W1), confirmable via a `winr_` receipt. */
export type WindowOption = {
    readonly receipt_id: string;
    readonly option_id: string;
    readonly label: string;
    readonly relative_id?: RelativeWindowID;
    readonly start?: string;
    readonly end?: string;
};

/** Every window option a stored result offered (CHAOS-3900 W1). */
export type WindowClarification = {
    readonly options: readonly WindowOption[];
};

/**
 * One grammar the engine accepts for explicit supply, so a caller can
 * supply structure directly next turn instead of picking from offers.
 * `pattern_id` is registry-pinned, never regex text.
 */
export type AcceptedGrammar = {
    readonly member: StructureNeedKind;
    readonly kind?: StructureSubjectKind;
    readonly pattern_id: string;
};

/**
 * The disclosure block: present whenever an investigation round ends short
 * of decisive (`clarification_required`, ambiguous `no_match`,
 * `no_discriminators` refusal), never dropped once present (the Limitations
 * discipline, §2.1's "never-truncated pin").
 */
export type StructureNeeds = {
    /** Ordered by elicitation priority: kind, anchor, window (§1.2 reading 1). */
    readonly missing: readonly StructureNeedKind[];
    readonly kind_options?: readonly KindOption[];
    readonly anchor_options?: readonly AnchorOption[];
    readonly handle_options?: readonly HandleOption[];
    /** 3900's own type, verbatim (§2.1). */
    readonly window_options?: readonly WindowOption[];
    readonly accepted_grammars?: readonly AcceptedGrammar[];
};

/**
 * The wire-visible disposition for one carried structure member — present
 * whenever the request carried ANY structure receipt or explicit structure
 * field, one entry PER carried member, INCLUDING vetoed ones. This IS the
 * silent-drop closure for structure (§2.1): unlike `prior_subject_receipts`
 * (CHAOS-3813, still unclosed acr-side — see `src/lib/clarification.ts`),
 * structure confirmation gets its wire-visible echo from day one, so no
 * client-side detection heuristic is needed here — only rendering it.
 */
export type ConfirmedStructureEntry = {
    readonly member: StructureNeedKind;
    readonly applied_value: string;
    readonly source: StructureSource;
    readonly prior_result_id?: string;
    readonly receipt_id?: string;
    readonly offer_source?: StructureOfferSource;
    readonly prior_version_id?: string;
    readonly prior_entry_id?: string;
    readonly provenance: StructureProvenance;
    readonly disposition: StructureDisposition;
};

/**
 * One echoed offer inside a decisive result's `structure_offer_snapshot`
 * (§2.1's B5 gap). Ids/ranks/enums only, never display text — canonical
 * storage only upstream, but the wire shape is identical when a projection
 * carries it.
 */
export type StructureOfferSnapshotEntry = {
    readonly member: StructureNeedKind;
    readonly offer_id: string;
    readonly rank: number;
    readonly offer_source: StructureOfferSource;
    readonly prior_version_id?: string;
    readonly prior_entry_id?: string;
};

/**
 * An `InvestigationResult`, additively widened with the four P1(+W1) blocks
 * that do not exist on the pinned contract yet. See the file header's
 * "THE SEAM": once the pin bumps past P1, these fields belong on the
 * generated `InvestigationResult` itself and this widening type is deleted.
 */
export type StructureAwareResult<TResult> = TResult & {
    readonly structure_needs?: StructureNeeds;
    readonly confirmed_structure?: readonly ConfirmedStructureEntry[];
    readonly structure_offer_snapshot?: readonly StructureOfferSnapshotEntry[];
    readonly window_clarification?: WindowClarification;
};

/**
 * An `InvestigationRequest`, additively widened with the four P1(+W1)
 * `prior_*_receipts` fields. Mirrors `StructureAwareResult`'s reasoning.
 */
export type StructureAwareRequest<TRequest> = TRequest & {
    readonly prior_kind_receipts?: readonly BoundStructureReceipt[];
    readonly prior_anchor_receipts?: readonly BoundStructureReceipt[];
    readonly prior_handle_receipts?: readonly BoundStructureReceipt[];
    readonly prior_window_receipts?: readonly BoundStructureReceipt[];
};

/**
 * Same shape as the contract's `BoundSubjectReceipt` — `{result_id,
 * receipt_id}` — but the four structure namespaces are each their OWN
 * closed receipt-id prefix (design brief §2.1's closed
 * kindr_/ancr_/handr_/winr_ set: "none of the four ... may ever accept
 * another's namespace"). One shared TS shape; the prefix is enforced by
 * `structureReceiptNamespace` at the boundary (the route), matching the
 * schema's `KindBoundReceipt`/`AnchorBoundReceipt`/`HandleBoundReceipt`/
 * `WindowBoundReceipt` — four distinct schema types with the identical
 * object shape, each pattern-constrained on `receipt_id` only.
 */
export type BoundStructureReceipt = {
    readonly result_id: string;
    readonly receipt_id: string;
};

/** The closed kindr_/ancr_/handr_/winr_ namespace prefixes (§2.1). */
export const STRUCTURE_RECEIPT_PREFIX = {
    expected_kind: "kindr_",
    subject_anchor: "ancr_",
    subject_handle: "handr_",
    window: "winr_",
} as const satisfies Record<StructureNeedKind, string>;

/** Every member the panel can render an offer for, in elicitation-priority order. */
export const STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER: readonly StructureNeedKind[] = [
    "expected_kind",
    "subject_anchor",
    "subject_handle",
    "window",
];
