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
    /**
     * True when a higher-priority surface renders this same fact in full.
     * `SURFACE_PRIORITY` is a domain ranking, NOT the page's render order
     * (codex round 3, finding 3: `readiness_gaps` outranks `remaining_work`
     * here, but `remaining_work` renders FIRST on the page — a cross-
     * reference wording that claimed the primary was "already" shown would
     * be false whenever the primary's surface renders below this one).
     * Callers must not phrase this as "already shown" or "shown above".
     */
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

/** The facts key (`claimed_fact_ids`, sorted+joined) when present, else `undefined`. */
function factsKeyOf(finding: Finding): string | undefined {
    const factIds = finding.claimed_fact_ids;
    if (factIds === undefined || factIds.length === 0) return undefined;
    return `facts:${[...factIds].sort().join(",")}`;
}

function textKeyOf(text: string): string {
    return `text:${normalizeText(text)}`;
}

/**
 * A registered claim: which surface owns the full rendering, and — for the
 * TEXT key specifically — whether an explicit facts key claimed it (and
 * which one). That second field is what makes matching order-independent
 * (codex round 3, finding 1): whichever of an id-bearing/id-less pair of
 * the same fact is processed FIRST, the other must still resolve to it.
 */
type Claim = { readonly surface: FindingSurface; readonly ownerFactsKey: string | undefined };

/**
 * Resolves one item against everything claimed SO FAR.
 *
 * - An id-LESS item (`factsKey` undefined) matches purely on text, against
 *   ANY earlier claim of that text key — id-bearing or not. Text is the
 *   only signal it has, so it is always authoritative for it (round 1: a
 *   fact re-filed without its id still finds the id-bearing original).
 * - An id-BEARING item first checks its OWN facts key: an exact match there
 *   is unconditionally a duplicate (same explicit identity). Failing that,
 *   it falls back to the text key — but ONLY treats a text match as the
 *   same fact when that key's owner has NO explicit id of its own, or the
 *   SAME id. A text match owned by a DIFFERENT explicit id is a conflict,
 *   not evidence of sameness (round 2, finding 1: two distinct facts must
 *   never collapse just because their wording matches) — this item becomes
 *   its own primary instead.
 *
 * A match makes this item a duplicate of the owner's surface — REGARDLESS
 * of whether the owner is this same surface or a different one (round 2,
 * finding 2: comparing `owner !== surface` let a second identical fact
 * filed twice on the SAME surface render in full twice).
 *
 * CHAIN PROPAGATION (codex R4 full-base round — the pairwise truth table
 * missed this, since it only covers a leader/follower PAIR): every item
 * that resolves to an EXISTING owner still donates every identity signal
 * IT carries — not just the ones needed for its own match — so a THIRD
 * item reaching the same fact through a DIFFERENT signal still finds it.
 * Concretely: an id-bearing item that merges via the text bridge (its own
 * facts key was unclaimed) still registers that facts key against the true
 * owner, so a LATER item with the identical facts key finds it directly
 * without depending on that specific text bridge still existing. Symmetric
 * case: an id-bearing item that merges via its OWN facts key still donates
 * its own text as a bridge, so a later id-LESS item matching THIS item's
 * particular wording (not necessarily the original primary's wording)
 * still resolves to the same fact. Both are guarded by `!claims.has(...)`
 * (first-claim-wins) — donating a signal never overwrites an earlier,
 * differently-identified item's claim to that same key.
 *
 * Only when no match is found at all does this item become a brand new
 * primary: it claims its own facts key (if any) and the text key — again
 * never overwriting a key an earlier, differently-identified item already
 * claims, so a conflicting explicit id can never steal another fact's text
 * slot.
 */
function resolve(
    claims: Map<string, Claim>,
    surface: FindingSurface,
    factsKey: string | undefined,
    textKey: string,
): { readonly isDuplicate: boolean; readonly primarySurface: FindingSurface } {
    if (factsKey === undefined) {
        const byText = claims.get(textKey);
        if (byText !== undefined) return { isDuplicate: true, primarySurface: byText.surface };
        claims.set(textKey, { surface, ownerFactsKey: undefined });
        return { isDuplicate: false, primarySurface: surface };
    }

    const byFacts = claims.get(factsKey);
    if (byFacts !== undefined) {
        // Donate this occurrence's own wording as a text bridge too, even
        // though it matched via its facts key — a later id-less item using
        // THIS wording (not necessarily the original primary's) must still
        // find the same fact.
        if (!claims.has(textKey)) {
            claims.set(textKey, { surface: byFacts.surface, ownerFactsKey: factsKey });
        }
        return { isDuplicate: true, primarySurface: byFacts.surface };
    }

    const byText = claims.get(textKey);
    if (
        byText !== undefined &&
        (byText.ownerFactsKey === undefined || byText.ownerFactsKey === factsKey)
    ) {
        // Donate this occurrence's own facts key too, even though it
        // matched via the text bridge — a later item sharing this exact
        // explicit id must find the fact directly, without depending on
        // this specific text bridge still being intact (codex R4).
        if (!claims.has(factsKey)) {
            claims.set(factsKey, { surface: byText.surface, ownerFactsKey: factsKey });
        }
        return { isDuplicate: true, primarySurface: byText.surface };
    }

    claims.set(factsKey, { surface, ownerFactsKey: factsKey });
    if (!claims.has(textKey)) claims.set(textKey, { surface, ownerFactsKey: factsKey });
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
    const claims = new Map<string, Claim>();
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
                    undefined,
                    textKeyOf(text),
                );
                return { text, isDuplicate, primarySurface };
            });
        } else {
            findingResults[surface] = input[surface].map((finding) => {
                const { isDuplicate, primarySurface } = resolve(
                    claims,
                    surface,
                    factsKeyOf(finding),
                    textKeyOf(finding.summary),
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
