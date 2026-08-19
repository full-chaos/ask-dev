/**
 * Stable names for the generated contract types.
 *
 * The generated modules under src/contracts/generated are rewritten wholesale
 * on every pin bump, and their exported identifiers are derived from the JSON
 * Schema `title` fields, so they are not ours to depend on directly. Every
 * component imports from here instead; a pin bump that renames a generated type
 * is then a one-line change in this file, not a sweep through the UI.
 */
export type {
    ACRContextFabricInvestigationResultV1 as InvestigationResult,
    Coverage,
    DriverJudgment,
    Finding,
    InterpretedQuestion,
    RelationshipPath,
    SubjectCandidate,
    SubjectRef,
    SubjectResolution,
    VersionSet,
} from "@/contracts/generated/investigation-result";

export type { ACRContextFabricInvestigationRequestV1 as InvestigationRequest } from "@/contracts/generated/investigation-request";

export type { ACRErrorV1 as AcrError } from "@/contracts/generated/error";

/**
 * CHAOS-3927 P2 (pivot-intent design brief §2.1/§2.3). PENDING-P1: these
 * come from the hand-mirrored `@/lib/pivot/structure-contracts`, not from a
 * generated module, because the pinned acr commit predates P1/W1 entirely.
 * See that file's header ("THE SEAM") for the one-time migration once the
 * pin bumps past P1's acr merge — every other file imports these names from
 * here, never from `@/lib/pivot/structure-contracts` directly, so that
 * migration touches this block only.
 */
export type {
    AcceptedGrammar,
    AnchorOption,
    BoundStructureReceipt,
    ConfirmedStructureEntry,
    HandleOption,
    KindOption,
    RelativeWindowID,
    StructureAwareRequest,
    StructureAwareResult,
    StructureDisposition,
    StructureNeedKind,
    StructureNeeds,
    StructureOfferSnapshotEntry,
    StructureOfferSource,
    StructureProvenance,
    StructureSource,
    StructureSubjectKind,
    WindowClarification,
    WindowOption,
} from "@/lib/pivot/structure-contracts";
export {
    STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER,
    STRUCTURE_RECEIPT_PREFIX,
} from "@/lib/pivot/structure-contracts";

/**
 * The result shape every P2 component actually renders: the generated
 * `InvestigationResult` widened with the P1(+W1) blocks. Once the pin bumps
 * past P1 this collapses to plain `InvestigationResult` (see the seam note
 * above).
 */
export type PivotAwareInvestigationResult =
    import("@/lib/pivot/structure-contracts").StructureAwareResult<
        import("@/contracts/generated/investigation-result").ACRContextFabricInvestigationResultV1
    >;

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
