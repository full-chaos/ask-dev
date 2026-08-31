import type { Finding } from "@/lib/contracts";

/**
 * CHAOS-4669 defect 1: "one fact renders 3+ times per answer" — chris's UX
 * notes named the readiness-gap fact appearing near-verbatim in the answer
 * prose, the Remaining Work card, the Readiness Gaps card, AND the
 * Limitations list. This module computes ONE primary rendering per fact
 * across the four surfaces that can carry a Finding-shaped judgment
 * (`remaining_work`/`readiness_gaps`/`conflicts`/`limitations`) — every
 * other surface that would otherwise repeat it gets a compact cross-
 * reference instead, never a silent drop (AGENTS.md: UX renders only
 * persisted values, and a missing fact must never look like the service
 * never sent it).
 *
 * The answer prose itself (`AnswerPanel`) is out of scope here — it is the
 * service's own non-model wording, and this repo does not rewrite or
 * reorder it (see `AnswerPanel`'s own doc comment). Deduping the four
 * FACT-CARD surfaces against each other closes the defect the ticket can
 * actually fix without crossing that boundary.
 */

export type FindingSurface = "remaining_work" | "readiness_gaps" | "conflicts" | "limitations";

/** Reader-facing label for a surface, used in a duplicate's cross-reference sentence. */
export const SURFACE_LABEL: Readonly<Record<FindingSurface, string>> = {
    remaining_work: "Remaining work",
    readiness_gaps: "Readiness gaps",
    conflicts: "Conflicts",
    limitations: "Limitations",
};

/**
 * Priority order for which surface keeps the FULL rendering when the same
 * fact appears on more than one. `readiness_gaps` and `remaining_work`
 * outrank `conflicts` and `limitations` because they carry evidence
 * (`Finding.evidence_ref_ids`) and a `kind` classification a plain
 * limitation string cannot — the richer surface should never collapse in
 * favor of the thinner one. `readiness_gaps` outranks `remaining_work`
 * because "why this isn't ready" is the more specific claim of the two
 * when a fact is filed under both (a readiness gap is inherently also
 * "work remaining", the reverse is not true).
 */
const SURFACE_PRIORITY: readonly FindingSurface[] = [
    "readiness_gaps",
    "remaining_work",
    "conflicts",
    "limitations",
];

export type DedupedFinding = {
    readonly finding: Finding;
    /** True when a HIGHER-priority surface already renders this same fact in full. */
    readonly isDuplicate: boolean;
    /** The surface that owns the full rendering — this surface itself when `isDuplicate` is false. */
    readonly primarySurface: FindingSurface;
};

export type DedupedLimitation = {
    readonly text: string;
    readonly isDuplicate: boolean;
    readonly primarySurface: FindingSurface;
};

export type DedupedFindingsInput = {
    readonly remaining_work: readonly Finding[];
    readonly readiness_gaps: readonly Finding[];
    readonly conflicts: readonly Finding[];
    readonly limitations: readonly string[];
};

export type DedupedFindingsResult = {
    readonly remaining_work: readonly DedupedFinding[];
    readonly readiness_gaps: readonly DedupedFinding[];
    readonly conflicts: readonly DedupedFinding[];
    readonly limitations: readonly DedupedLimitation[];
};

/**
 * A dedup key that is exact and case/whitespace-insensitive — "near-verbatim"
 * duplicates (the ticket's own word) survive a re-wrap or a trailing-space
 * difference, but two genuinely different sentences never collide.
 */
function normalizeText(text: string): string {
    return text.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

/**
 * `claimed_fact_ids` is the strongest possible signal — two Findings citing
 * the SAME underlying fact set are the same fact restated, regardless of
 * how differently they are worded. It is optional and frequently absent on
 * real data (the pinned canonical example's own `remaining_work` entry
 * carries none), so this falls back to normalized-summary-text equality,
 * which is what actually catches the ticket's "near-verbatim" case.
 */
function findingKey(finding: Finding): string {
    const factIds = finding.claimed_fact_ids;
    if (factIds !== undefined && factIds.length > 0) {
        return `facts:${[...factIds].sort().join(",")}`;
    }
    return `text:${normalizeText(finding.summary)}`;
}

function limitationKey(text: string): string {
    return `text:${normalizeText(text)}`;
}

/**
 * Computes the primary-surface assignment for every Finding/limitation in
 * one result. First-claim-wins in `SURFACE_PRIORITY` order — deterministic
 * from the answer alone, never from array iteration order or a Map's
 * insertion order of some OTHER structure (the same discipline
 * `groupFactsByTable` in `fact-rows.ts` documents for its own first-seen
 * tiebreak).
 */
export function dedupeFindings(input: DedupedFindingsInput): DedupedFindingsResult {
    const primarySurfaceForKey = new Map<string, FindingSurface>();
    function claim(surface: FindingSurface, key: string): void {
        if (!primarySurfaceForKey.has(key)) primarySurfaceForKey.set(key, surface);
    }
    for (const surface of SURFACE_PRIORITY) {
        if (surface === "limitations") {
            for (const text of input.limitations) claim(surface, limitationKey(text));
        } else {
            for (const finding of input[surface]) claim(surface, findingKey(finding));
        }
    }

    function resolveFindings(
        surface: FindingSurface,
        findings: readonly Finding[],
    ): readonly DedupedFinding[] {
        return findings.map((finding) => {
            const primarySurface = primarySurfaceForKey.get(findingKey(finding)) ?? surface;
            return { finding, isDuplicate: primarySurface !== surface, primarySurface };
        });
    }

    return {
        remaining_work: resolveFindings("remaining_work", input.remaining_work),
        readiness_gaps: resolveFindings("readiness_gaps", input.readiness_gaps),
        conflicts: resolveFindings("conflicts", input.conflicts),
        limitations: input.limitations.map((text) => {
            const primarySurface = primarySurfaceForKey.get(limitationKey(text)) ?? "limitations";
            return { text, isDuplicate: primarySurface !== "limitations", primarySurface };
        }),
    };
}

/**
 * Wraps a plain limitations list with no cross-surface dedup — every entry
 * is its own primary. For call sites with no Findings panels to dedupe
 * against (the `clarification_required` branch renders `LimitationsPanel`
 * but none of the three Finding lists), so there is nothing to compute.
 */
export function identityLimitations(limitations: readonly string[]): readonly DedupedLimitation[] {
    return limitations.map((text) => ({ text, isDuplicate: false, primarySurface: "limitations" }));
}
