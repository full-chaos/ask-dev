/**
 * Presentation helpers.
 *
 * These map contract vocabulary to a display tone. They never re-judge, never
 * derive a health state, and never gate anything — the workbench renders what
 * the service said (CHAOS-3738 boundary). The raw contract term is always shown
 * alongside the tone, so a reader can see the vocabulary, not just the color.
 */
import type { CoverageState, InvestigationStatus, SubjectCandidateState } from "@/lib/contracts";

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
