/**
 * Presentation helpers.
 *
 * These map contract vocabulary to a display tone. They never re-judge, never
 * derive a health state, and never gate anything — the workbench renders what
 * the service said (CHAOS-3738 boundary). The raw contract term is always shown
 * alongside the tone, so a reader can see the vocabulary, not just the color.
 */
import type {
    CoverageState,
    InvestigationStatus,
    PriorSubjectReceiptDisposition,
    StructureDisposition,
    SubjectCandidateState,
} from "@/lib/contracts";

export type Tone = "ok" | "warn" | "bad" | "neutral";

/** Tone for one `coverage.sources[].state`. Exhaustive over the closed enum. */
export function coverageStateTone(state: CoverageState): Tone {
    switch (state) {
        case "available":
            return "ok";
        case "stale":
        case "truncated":
        case "conflicted":
        case "pruned":
            return "warn";
        case "unavailable":
        case "unauthorized":
            return "bad";
        case "unconfigured":
        case "no_data":
        case "not_applicable":
            return "neutral";
    }
}

/** Tone for the result status. Exhaustive over the closed enum. */
export function statusTone(status: InvestigationStatus): Tone {
    switch (status) {
        case "complete":
            return "ok";
        case "partial":
        case "degraded":
        case "clarification_required":
            return "warn";
        case "no_match":
            return "neutral";
    }
}

/** Tone for one subject candidate. Exhaustive over the closed enum. */
export function candidateStateTone(state: SubjectCandidateState): Tone {
    switch (state) {
        case "committed":
            return "ok";
        case "proposed":
            return "neutral";
        case "ambiguous":
            return "warn";
        case "unresolved":
            return "bad";
    }
}

/**
 * Tone for one `ConfirmedStructureEntry.disposition` (CHAOS-3927 P2, design
 * brief §2.1's silent-drop closure). Exhaustive over the closed enum: a
 * disposition value the raw contract term switch does not know about is a
 * compile error here rather than a value that silently reads as "applied".
 */
export function structureDispositionTone(disposition: StructureDisposition): Tone {
    switch (disposition) {
        case "applied":
            return "ok";
        case "vetoed_unresolved":
        case "vetoed_conflict":
        case "vetoed_stale":
            return "bad";
    }
}

/**
 * Tone for one `SubjectResolution.prior_subject_receipt_dispositions[]`
 * entry (CHAOS-3478/CHAOS-3813). Exhaustive over the closed enum, same
 * discipline as `structureDispositionTone` above — a skip here never vetoes
 * the investigation (it is a best-effort, plural hint list, not a gate), so
 * every `skipped_*` reads as `warn`, not `bad`.
 */
export function priorSubjectReceiptDispositionTone(
    disposition: PriorSubjectReceiptDisposition,
): Tone {
    switch (disposition) {
        case "applied":
            return "ok";
        case "skipped_unloadable":
        case "skipped_no_match":
        case "skipped_stale_graph_epoch":
        case "skipped_failed_reauth":
            return "warn";
    }
}

/**
 * Renders a `snake_case` contract term for reading, without losing it: callers
 * show this next to (or as the title of) the raw term.
 */
export function humanizeTerm(term: string): string {
    return term.replaceAll("_", " ");
}

/** Formats a 0..1 contract confidence as a percentage. */
export function formatConfidence(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
}
