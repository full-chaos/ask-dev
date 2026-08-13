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
