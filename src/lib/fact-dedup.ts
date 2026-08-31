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
 * The identity key(s) used to MATCH `finding` against everything claimed so
 * far. When `claimed_fact_ids` is present it is AUTHORITATIVE — two
 * findings that both declare an explicit (and different) fact identity are
 * different facts, full stop, even if their summaries happen to read
 * identically (codex round 2, finding 1: two distinct facts with distinct
 * `claimed_fact_ids` collapsed because both also matched on shared text).
 * Only when a finding carries NO `claimed_fact_ids` does text become the
 * matching key — the weak signal used to catch a fact re-filed without its
 * id (codex round 1, finding 3).
 */
function matchKeys(finding: Finding): readonly string[] {
    const factIds = finding.claimed_fact_ids;
    if (factIds !== undefined && factIds.length > 0) {
        return [`facts:${[...factIds].sort().join(",")}`];
    }
    return [`text:${normalizeText(finding.summary)}`];
}

/**
 * The full set of keys `finding` REGISTERS once it becomes a primary — the
 * text key always (so a LATER id-less duplicate of the same wording can
 * still find it), plus the facts key when present. Distinct from
 * `matchKeys`: a fact WITH an id only ever matches by its id (above), but
 * it still donates its text key for others to match against.
 */
function claimKeys(finding: Finding): readonly string[] {
    const keys = [`text:${normalizeText(finding.summary)}`];
    const factIds = finding.claimed_fact_ids;
    if (factIds !== undefined && factIds.length > 0) {
        keys.push(`facts:${[...factIds].sort().join(",")}`);
    }
    return keys;
}

function limitationMatchAndClaimKeys(text: string): readonly string[] {
    return [`text:${normalizeText(text)}`];
}

/**
 * Resolves one item against everything claimed SO FAR, using its own
 * `matchKeys` (identity-authoritative: facts key ONLY when present, else
 * the text key). A match makes this item a duplicate of the owner's
 * surface — REGARDLESS of whether the owner is this same surface or a
 * different one (codex round 2, finding 2: comparing `owner !== surface`
 * let a second identical fact filed twice on the SAME surface render in
 * full twice, since its own surface "owned" the key). Only when NO match is
 * found does this item become a new primary, claiming every one of
 * `claimKeys` — but never overwriting a key some earlier item already
 * claimed, so an explicit-id fact's text never steals a key a different
 * explicit-id fact already owns.
 */
function resolve(
    claims: Map<string, FindingSurface>,
    surface: FindingSurface,
    matching: readonly string[],
    claiming: readonly string[],
): { readonly isDuplicate: boolean; readonly primarySurface: FindingSurface } {
    for (const key of matching) {
        const owner = claims.get(key);
        if (owner !== undefined) return { isDuplicate: true, primarySurface: owner };
    }
    for (const key of claiming) {
        if (!claims.has(key)) claims.set(key, surface);
    }
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
                const keys = limitationMatchAndClaimKeys(text);
                const { isDuplicate, primarySurface } = resolve(claims, surface, keys, keys);
                return { text, isDuplicate, primarySurface };
            });
        } else {
            findingResults[surface] = input[surface].map((finding) => {
                const { isDuplicate, primarySurface } = resolve(
                    claims,
                    surface,
                    matchKeys(finding),
                    claimKeys(finding),
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
