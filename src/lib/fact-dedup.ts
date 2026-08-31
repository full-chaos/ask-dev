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
 * Every key that identifies `finding` as "the same fact" — ALWAYS the
 * normalized-text key, PLUS the `claimed_fact_ids` key when the finding
 * carries one. `claimed_fact_ids` is optional and frequently absent on real
 * data (the pinned canonical example's own `remaining_work` entry carries
 * none), so a caller that keyed EXCLUSIVELY on whichever field happened to
 * be present (codex round 1, finding 3) missed a real duplicate: the same
 * fact filed once WITH `claimed_fact_ids` and once WITHOUT it produced two
 * different keys (`facts:...` vs `text:...`) and rendered twice. Computing
 * BOTH keys here and matching on EITHER (see `resolve` below) closes that
 * gap regardless of which surface happens to carry the id.
 */
function findingKeys(finding: Finding): readonly string[] {
    const keys = [`text:${normalizeText(finding.summary)}`];
    const factIds = finding.claimed_fact_ids;
    if (factIds !== undefined && factIds.length > 0) {
        keys.push(`facts:${[...factIds].sort().join(",")}`);
    }
    return keys;
}

function limitationKeys(text: string): readonly string[] {
    return [`text:${normalizeText(text)}`];
}

/**
 * Resolves one item against everything claimed SO FAR: if any of its own
 * keys already has an owner, this item is a duplicate of that owner's
 * surface (regardless of which specific key matched — a text-key match and
 * a facts-key match are both "the same fact", per `findingKeys`'s own
 * doc comment). Otherwise this item becomes the primary and claims EVERY
 * one of its keys, so a LATER item reachable via any of them — even one
 * that only shares the text key, or only the facts key — resolves to this
 * item's surface too.
 */
function resolve(
    claims: Map<string, FindingSurface>,
    surface: FindingSurface,
    keys: readonly string[],
): { readonly isDuplicate: boolean; readonly primarySurface: FindingSurface } {
    for (const key of keys) {
        const owner = claims.get(key);
        if (owner !== undefined) return { isDuplicate: owner !== surface, primarySurface: owner };
    }
    for (const key of keys) claims.set(key, surface);
    return { isDuplicate: false, primarySurface: surface };
}

/**
 * Computes the primary-surface assignment for every Finding/limitation in
 * one result. First-claim-wins, processed in `SURFACE_PRIORITY` order
 * (readiness_gaps, remaining_work, conflicts, limitations) — deterministic
 * from the answer alone, never from array iteration order or a Map's
 * insertion order of some OTHER structure (the same discipline
 * `groupFactsByTable` in `fact-rows.ts` documents for its own first-seen
 * tiebreak).
 */
export function dedupeFindings(input: DedupedFindingsInput): DedupedFindingsResult {
    const claims = new Map<string, FindingSurface>();
    const findingResults: Record<Exclude<FindingSurface, "limitations">, DedupedFinding[]> = {
        remaining_work: [],
        readiness_gaps: [],
        conflicts: [],
    };
    let limitations: readonly DedupedLimitation[] = [];

    // Driven by `SURFACE_PRIORITY` itself (not a hand-ordered sequence of
    // calls) so the priority list stays the single source of truth for
    // this order — nothing here can drift from what the const declares.
    for (const surface of SURFACE_PRIORITY) {
        if (surface === "limitations") {
            limitations = input.limitations.map((text) => {
                const { isDuplicate, primarySurface } = resolve(
                    claims,
                    surface,
                    limitationKeys(text),
                );
                return { text, isDuplicate, primarySurface };
            });
        } else {
            findingResults[surface] = input[surface].map((finding) => {
                const { isDuplicate, primarySurface } = resolve(
                    claims,
                    surface,
                    findingKeys(finding),
                );
                return { finding, isDuplicate, primarySurface };
            });
        }
    }

    return {
        remaining_work: findingResults.remaining_work,
        readiness_gaps: findingResults.readiness_gaps,
        conflicts: findingResults.conflicts,
        limitations,
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
