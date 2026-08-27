import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import type { InvestigationResult, StructureNeedKind } from "@/lib/contracts";
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
    /**
     * Question family.
     *
     * `interpretation.shape` ONLY — a closed contract enum
     * (`single_subject` | `explicit_cohort` | `discovered_cohort` | `open`).
     *
     * `requested_judgment` was here and has been REMOVED: the contract
     * constrains it only to be a string of at most 256 characters, so it is
     * model-derived free text, and free text in telemetry is egress no matter
     * how short. `shape` is the bounded family signal, and it is enough to
     * answer "what kind of question was this" without carrying anything
     * generated.
     */
    readonly questionShape: string | undefined;
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

    /**
     * Coverage, as PAIRS rather than parallel arrays.
     *
     * Deduplicating sources and states independently destroyed both the pairing
     * and the count: two unrecognized sources in different states collapsed to
     * one `"other"` source beside two unrelated states, so neither "which state
     * was that source in" nor "how many sources were unrecognized" survived —
     * which is the count-preservation the mapping was supposed to guarantee.
     *
     * Every token here is still bounded: the source is a vocabulary member or
     * `"other"`, and the state is a contract enum. Pairing changes what is
     * knowable, not what is carried.
     */
    readonly coveragePartial: boolean | undefined;
    readonly coverageSourceStates: readonly { readonly source: string; readonly state: string }[];
    /** How many sources fell outside the known vocabulary. */
    readonly unknownSourceCount: number;
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
    /**
     * Whether a carried choice was actually applied by ACR.
     *
     * ACR discards a clarification receipt without reporting it (CHAOS-3813),
     * so the disambiguation path can fail silently. This records THAT it
     * happened — never which subject was chosen, which would be content.
     * `undefined` when no choice was carried, which is distinct from `false`:
     * "no choice to honour" and "the choice was ignored" must not aggregate
     * together.
     */
    readonly clarificationChoiceHonoured: boolean | undefined;

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
    readonly clarificationChoiceHonoured?: boolean | undefined;
    readonly usefulness?: UsefulnessFeedback | undefined;
    readonly correctness?: CorrectnessFeedback | undefined;
};

function outcomeFor(input: OutcomeInput): WorkbenchOutcome {
    if (input.result === undefined) return "failed";
    if (input.result.status === "clarification_required") return "clarification_required";
    if (input.result.status === "no_match") return "no_match";
    return "answered";
}

/**
 * Coverage source names are NOT bounded by the contract — the schema types
 * `source` as a 1..128 character string, so it is free text as far as the wire
 * is concerned, and free text in telemetry is egress however identifier-shaped
 * it usually looks.
 *
 * They are therefore mapped to a known vocabulary and anything outside it
 * becomes `"other"`. The COUNT is preserved (the source still appears, so
 * "how many sources" and "were any unrecognized" stay answerable); only the
 * string is dropped.
 *
 * The fact-kind half is derived from the pinned schema rather than hand-copied,
 * so a pin bump that adds a kind picks it up automatically.
 */
const FACT_KINDS: ReadonlySet<string> = new Set(
    (
        commonSchema as {
            $defs: { FactRequirement: { properties: { kind: { enum?: string[] } } } };
        }
    ).$defs.FactRequirement.properties.kind.enum ?? [],
);

const KNOWN_SOURCES: ReadonlySet<string> = new Set(["context-fabric:graph"]);

export const UNRECOGNIZED_SOURCE = "other";

export function boundedCoverageSource(source: string): string {
    if (KNOWN_SOURCES.has(source)) return source;
    for (const prefix of ["canonical_fact:", "dev-health-ops:"]) {
        if (!source.startsWith(prefix)) continue;
        const kind = source.slice(prefix.length);
        if (FACT_KINDS.has(kind)) return source;
    }
    return UNRECOGNIZED_SOURCE;
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
        // Per-instance and ORDER-STABLE: sorted by (source, state) so an event
        // is comparable across runs, but never collapsed, so two unrecognized
        // sources in different states stay two entries.
        coverageSourceStates: (coverage?.sources ?? [])
            .map((source) => ({
                source: boundedCoverageSource(source.source),
                state: source.state,
            }))
            .sort(
                (left, right) =>
                    left.source.localeCompare(right.source) ||
                    left.state.localeCompare(right.state),
            ),
        unknownSourceCount: (coverage?.sources ?? []).filter(
            (source) => boundedCoverageSource(source.source) === UNRECOGNIZED_SOURCE,
        ).length,
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
        clarificationChoiceHonoured: input.clarificationChoiceHonoured,

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

/**
 * Structure-offer selection outcome (CHAOS-4171 standing order: telemetry
 * baked into new logic, same PR).
 *
 * `StructureNeedsPanel`'s own `toggle()` has exactly two outcomes for a tap
 * on an offer: the namespace guard passes and the selection is applied
 * (`submitted`), or it fails and the selection is rejected
 * (`rejected_malformed` — `structureReceiptHasExpectedNamespace`'s own
 * "should be unreachable, but 'should' is not 'is'" case). Symmetric across
 * all five offer members (kind/anchor/handle/window/candidate) — the four
 * that predate CHAOS-4012 had no selection telemetry either; this closes
 * that gap for all five at once rather than adding it only for the new one.
 *
 * `member` reuses the contract's own closed `StructureNeedKind` vocabulary
 * rather than a hand-kept parallel list, matching this module's own
 * discipline elsewhere (fact kinds, coverage sources) of deriving closed
 * vocabularies from the pinned schema/contract instead of copying them.
 * Content-safe by construction: an option's id, label, or receipt is never a
 * parameter here, so there is nothing to accidentally carry.
 *
 * `carried_forward` (CHAOS-4355 stopgap) is a THIRD outcome, distinct from
 * both: it fires when `structure-carry.ts` injects a member into an
 * outgoing request that the tester did not pick THIS turn — a receipt
 * confirmed on an earlier turn, resent because ACR does not yet carry it
 * server-side (CHAOS-4360 is the real fix). Recording it separately from
 * `submitted` is the point: aggregating the two would hide how often the
 * stopgap is actually load-bearing versus how often testers are picking
 * fresh.
 */
export type StructureOfferSelectionOutcome = "submitted" | "rejected_malformed" | "carried_forward";

export type StructureOfferSelectionEvent = {
    readonly event: "workbench_structure_offer_selection";
    readonly member: StructureNeedKind;
    readonly outcome: StructureOfferSelectionOutcome;
};

export function buildStructureOfferSelectionEvent(
    member: StructureNeedKind,
    outcome: StructureOfferSelectionOutcome,
): StructureOfferSelectionEvent {
    return { event: "workbench_structure_offer_selection", member, outcome };
}
