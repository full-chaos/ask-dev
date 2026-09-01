/**
 * Presentation helpers.
 *
 * These map contract vocabulary to a display tone. They never re-judge, never
 * derive a health state, and never gate anything — the workbench renders what
 * the service said (CHAOS-3738 boundary). The raw contract term is always shown
 * alongside the tone, so a reader can see the vocabulary, not just the color.
 */
import type {
    CohortMemberDataCompleteness,
    CohortMemberOutcome,
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
 * Tone for one ranked `CohortMember.outcome` (CHAOS-4449; acr CHAOS-4398
 * PR3b). Exhaustive over the closed enum.
 *
 * `insufficient_evidence` and `not_applicable` are `neutral`, not `bad`:
 * neither is a poor result for the team, and colouring them as one would be
 * the presentation layer forming a judgment acr did not make (North Star
 * check 12 — missing is not healthy, but it is also not unhealthy).
 */
export function cohortOutcomeTone(outcome: CohortMemberOutcome): Tone {
    switch (outcome) {
        case "qualified":
            return "ok";
        case "provisional":
            return "warn";
        case "insufficient_evidence":
        case "not_applicable":
            return "neutral";
    }
}

/**
 * Tone for one ranked `CohortMember.data_completeness` (CHAOS-4449).
 * Exhaustive over the closed enum. This describes the EVIDENCE behind a row,
 * never the team's health.
 */
export function cohortDataCompletenessTone(completeness: CohortMemberDataCompleteness): Tone {
    switch (completeness) {
        case "complete":
            return "ok";
        case "partial":
            return "warn";
        case "degraded":
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

/**
 * Zero-width FORMAT characters (Unicode category Cf): invisible when
 * rendered, but NOT matched by `\s`/`String.prototype.trim()`, which strip
 * WHITESPACE (categories Zs/Zl/Zp) only. codex round 3, P2, EXECUTED: a
 * schema-valid `label` consisting of only U+200B satisfies a wire field's
 * `minLength: 1` while rendering as nothing at all — `trim() !== ""` alone
 * missed it. Written as explicit `\u` escapes, never the literal glyphs, so
 * this stays reviewable: U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH
 * NON-JOINER, U+200D ZERO WIDTH JOINER, U+FEFF ZERO WIDTH NO-BREAK SPACE
 * (also the UTF-8 BOM), U+2060 WORD JOINER — the characters actually
 * observed to cause this class of bug, not an attempt at a general
 * "is this glyph visible" classifier.
 */
// eslint-disable-next-line no-misleading-character-class -- intentional: U+200C/U+200D are listed as two ORDINARY disjunction members of this character class (each matched individually, stripped independently), not as a joiner sequence the class could be misread as.
const ZERO_WIDTH_FORMAT_CHARACTERS = /[\u200b\u200c\u200d\ufeff\u2060]/g;

/**
 * `undefined` unless `value` is a defined string with visible, non-blank
 * content.
 *
 * codex round 1 (CHAOS-4690/CHAOS-4691 consumer pin), P2, EXECUTED: an
 * optional engine-provided display string (`Coverage.sources[].label`/
 * `.state_label`, `CoverageDetail.phrasing`) has no `minLength` on the
 * wire, so `""` is schema-valid; `evidence_ref_labels`' values carry
 * `minLength: 1` but that still admits a lone space (round 1) or a lone
 * zero-width character (round 3). A bare `?? fallback` only catches
 * `undefined`/`null`, not a blank string — so a malformed-but-schema-valid
 * engine response could render a blank chip, a blank degraded-reason
 * sentence in place of its required `label`, or blank evidence text,
 * instead of falling through to the deterministic generic floor every
 * other absent-field path already uses. This is a pure PRESENCE check,
 * never a content guess: it returns `value` UNCHANGED (never stripped) when
 * it has any visible content, exactly like a plain `?? fallback` would.
 */
export function nonBlank(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const visible = value.replaceAll(ZERO_WIDTH_FORMAT_CHARACTERS, "").trim();
    return visible !== "" ? value : undefined;
}

/**
 * The "implementation-state" copy CHAOS-4673 named directly:
 * StructureNeedsPanel's and ClarificationPanel's own text for when the
 * surrounding surface has no `onConfirm`/`onToggle` to call — in practice, a
 * frozen (superseded) chat turn, rendered read-only by design. This is the
 * Workbench's OWN product chrome, not a vocabulary lookup over acr data
 * (CHAOS-4691's rip-out deletes the sentence-table module this used to live
 * in; this constant is presentation structure, not phrasing, and survives
 * the deletion per the ticket's own carve-out). A named export so both call
 * sites say the identical sentence rather than drifting.
 */
export const CANNOT_REASK_HERE_COPY = "These options can't be changed from this earlier message.";
