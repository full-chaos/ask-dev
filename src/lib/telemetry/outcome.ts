import type { InvestigationResult } from "@/lib/contracts";
import type { WorkbenchFailureCode } from "@/lib/acr/errors";
import type { EnrichmentPredicate } from "@/lib/enrichment/validate";

/**
 * Content-safe outcome telemetry (CHAOS-3738).
 *
 * The spec lists what to record: question family and outcome, subject/cohort
 * resolution path, ACR stage latency, graph and canonical-source coverage,
 * usefulness/correctness feedback, deterministic-versus-enriched render result,
 * fallback reason, evidence and path counts with truncation, and the
 * backend/projection/query/rule versions.
 *
 * It also says **content-safe**, and that word does the heavy lifting here. The
 * Workbench answers questions about real projects, teams, and people; a
 * telemetry record that carried the question text, the answer prose, a subject
 * label, or a driver summary would quietly turn an observability feature into a
 * data-egress one. So every field below is a COUNT, an ENUM drawn from the
 * contract's own closed vocabularies, or a VERSION STAMP. No free text from the
 * result — and none from the tester — ever reaches an event.
 *
 * "Question family" is derived from the result's own interpretation
 * (`shape` + `requested_judgment`), not from the question. Both are short,
 * ACR-owned tokens, so the family says what KIND of question was asked without
 * reproducing what was asked.
 */

export type RenderSurface = "deterministic" | "enriched" | "raw";

export type WorkbenchOutcome = "answered" | "clarification_required" | "no_match" | "failed";

export type UsefulnessFeedback = "useful" | "not_useful";
export type CorrectnessFeedback = "correct" | "incorrect" | "unsure";

export type OutcomeEvent = {
    readonly event: "workbench_investigation";
    /** Question family — a shape and judgment token, never the question. */
    readonly questionShape: string | undefined;
    readonly requestedJudgment: string | undefined;
    readonly outcome: WorkbenchOutcome;
    /** Contract status when there was a result. */
    readonly resultStatus: string | undefined;
    /** Failure code when there was not. */
    readonly failureCode: WorkbenchFailureCode | undefined;
    readonly upstreamStatus: number | undefined;
    readonly latencyMs: number;

    /** Subject/cohort resolution path, as counts and closed-vocabulary states. */
    readonly subjectCandidateCount: number;
    readonly subjectCandidateStates: readonly string[];
    readonly committedSubjectCount: number;
    readonly committedSubjectKinds: readonly string[];
    readonly cohortMemberCount: number;
    readonly cohortComplete: boolean | undefined;
    readonly cohortTruncated: boolean | undefined;

    /** Coverage: source names are ACR-owned capability identifiers, not content. */
    readonly coveragePartial: boolean | undefined;
    readonly coverageSources: readonly string[];
    readonly coverageStates: readonly string[];
    readonly degradedReasonCount: number;
    readonly limitationCount: number;
    readonly warningCount: number;

    /** Evidence and paths, with truncation. */
    readonly evidenceRefCount: number;
    readonly pathCount: number;
    readonly truncatedPathCount: number;
    readonly driverCount: number;
    readonly claimedFactCount: number;

    /** Render result and, when it fell back, why. */
    readonly renderSurface: RenderSurface;
    readonly enrichmentFellBack: boolean | undefined;
    readonly enrichmentFallbackPredicates: readonly EnrichmentPredicate[];

    /**
     * Whether this investigation carried a subject the tester chose from a
     * previous clarification. Records that the disambiguation path was taken —
     * never which subject was chosen, which would be content.
     */
    readonly clarificationChoiceCarried: boolean;

    readonly usefulness: UsefulnessFeedback | undefined;
    readonly correctness: CorrectnessFeedback | undefined;

    /** Provenance. */
    readonly backend: string | undefined;
    readonly backendVersion: string | undefined;
    readonly projectionVersion: string | undefined;
    readonly queryVersion: string | undefined;
    readonly interpretationVersion: string | undefined;
    readonly synthesisVersion: string | undefined;
    readonly reused: boolean | undefined;
};

export type OutcomeInput = {
    readonly latencyMs: number;
    readonly renderSurface: RenderSurface;
    readonly result?: InvestigationResult | undefined;
    readonly failureCode?: WorkbenchFailureCode | undefined;
    readonly upstreamStatus?: number | undefined;
    readonly enrichmentFellBack?: boolean | undefined;
    readonly enrichmentFallbackPredicates?: readonly EnrichmentPredicate[] | undefined;
    readonly clarificationChoiceCarried?: boolean | undefined;
    readonly usefulness?: UsefulnessFeedback | undefined;
    readonly correctness?: CorrectnessFeedback | undefined;
};

function outcomeFor(input: OutcomeInput): WorkbenchOutcome {
    if (input.result === undefined) return "failed";
    if (input.result.status === "clarification_required") return "clarification_required";
    if (input.result.status === "no_match") return "no_match";
    return "answered";
}

/** Distinct values, sorted, so an event is stable and cheap to aggregate. */
function distinct(values: readonly string[]): readonly string[] {
    return [...new Set(values)].sort();
}

export function buildOutcomeEvent(input: OutcomeInput): OutcomeEvent {
    const result = input.result;
    const coverage = result?.coverage;
    const versions = result?.versions;

    return {
        event: "workbench_investigation",
        questionShape: result?.interpretation.shape,
        requestedJudgment: result?.interpretation.requested_judgment,
        outcome: outcomeFor(input),
        resultStatus: result?.status,
        failureCode: input.failureCode,
        upstreamStatus: input.upstreamStatus,
        latencyMs: input.latencyMs,

        subjectCandidateCount: result?.subject_resolution.candidates.length ?? 0,
        subjectCandidateStates: distinct(
            (result?.subject_resolution.candidates ?? []).map((candidate) => candidate.state),
        ),
        committedSubjectCount: result?.subject_resolution.committed.length ?? 0,
        committedSubjectKinds: distinct(
            (result?.subject_resolution.committed ?? []).map((subject) => subject.kind),
        ),
        cohortMemberCount: result?.cohort?.members.length ?? 0,
        cohortComplete: result?.cohort?.complete,
        cohortTruncated: result?.cohort?.truncated,

        coveragePartial: coverage?.partial,
        coverageSources: distinct((coverage?.sources ?? []).map((source) => source.source)),
        coverageStates: distinct((coverage?.sources ?? []).map((source) => source.state)),
        degradedReasonCount: coverage?.degraded_reasons?.length ?? 0,
        limitationCount: result?.limitations.length ?? 0,
        warningCount: result?.warnings.length ?? 0,

        evidenceRefCount: result?.evidence_ref_ids.length ?? 0,
        pathCount: result?.paths.length ?? 0,
        truncatedPathCount: (result?.paths ?? []).filter((path) => path.truncated === true).length,
        driverCount: result?.drivers.length ?? 0,
        claimedFactCount: result?.claimed_facts.length ?? 0,

        renderSurface: input.renderSurface,
        enrichmentFellBack: input.enrichmentFellBack,
        enrichmentFallbackPredicates: input.enrichmentFallbackPredicates ?? [],

        clarificationChoiceCarried: input.clarificationChoiceCarried ?? false,

        usefulness: input.usefulness,
        correctness: input.correctness,

        backend: versions?.backend,
        backendVersion: versions?.backend_version,
        projectionVersion: versions?.projection_version,
        queryVersion: versions?.query_version,
        interpretationVersion: versions?.interpretation_version,
        synthesisVersion: versions?.synthesis_version,
        reused: result?.reused,
    };
}
