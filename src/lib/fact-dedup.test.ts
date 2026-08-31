import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/contracts";
import { dedupeFindings, identityLimitations } from "@/lib/fact-dedup";

function finding(overrides: Partial<Finding> & Pick<Finding, "finding_id" | "summary">): Finding {
    return {
        kind: "readiness",
        evidence_ref_ids: ["evidence_0001"],
        ...overrides,
    };
}

/**
 * CHAOS-4669 defect 1: chris's UX notes named the readiness-gap fact
 * rendering near-verbatim in the Remaining Work card, the Readiness Gaps
 * card, AND the Limitations list. This pins the exact scenario: one fact,
 * three cards, one primary rendering.
 */
describe("dedupeFindings: CHAOS-4669 defect 1 (one fact, one primary rendering)", () => {
    it("keeps a fact's full rendering on readiness_gaps and turns the SAME fact in remaining_work into a reference", () => {
        const readinessGap = finding({
            finding_id: "finding_readiness_gap",
            summary: "Release acceptance remains incomplete.",
        });
        const sameFactInRemainingWork = finding({
            finding_id: "finding_remaining_work_dup",
            summary: "Release acceptance remains incomplete.",
        });
        const result = dedupeFindings({
            remaining_work: [sameFactInRemainingWork],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });

        expect(result.readiness_gaps).toHaveLength(1);
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.readiness_gaps[0]!.primarySurface).toBe("readiness_gaps");

        expect(result.remaining_work).toHaveLength(1);
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
        expect(result.remaining_work[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("matches near-verbatim text (whitespace/case-insensitive), not just byte-identical", () => {
        const readinessGap = finding({
            finding_id: "finding_a",
            summary: "Release acceptance remains incomplete.",
        });
        const nearVerbatim = finding({
            finding_id: "finding_b",
            summary: "  release acceptance   remains incomplete.  ",
        });
        const result = dedupeFindings({
            remaining_work: [nearVerbatim],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
    });

    it("matches on shared claimed_fact_ids even when the wording differs", () => {
        const readinessGap = finding({
            finding_id: "finding_a",
            summary: "Release acceptance remains incomplete.",
            claimed_fact_ids: ["claim_readiness_0001"],
        });
        const differentWordingSameFact = finding({
            finding_id: "finding_b",
            summary: "The product acceptance gate has not passed yet.",
            claimed_fact_ids: ["claim_readiness_0001"],
        });
        const result = dedupeFindings({
            remaining_work: [differentWordingSameFact],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
        expect(result.remaining_work[0]!.primarySurface).toBe("readiness_gaps");
    });

    /**
     * codex round 1, finding 3 (EXECUTED repro): keying EXCLUSIVELY on
     * `claimed_fact_ids` when present, else EXCLUSIVELY on text, produced
     * incompatible keys (`facts:*` vs `text:*`) for the identical fact when
     * only ONE of the two occurrences carried the optional ids — codex's
     * own repro was one finding with `claimed_fact_ids` and one identical
     * summary WITHOUT it, rendering fully in both Remaining work and
     * Readiness gaps. `findingKeys` now always computes the text key too
     * and matches on ANY shared key.
     */
    it("matches by identical text even when only ONE occurrence carries claimed_fact_ids (codex round 1, finding 3)", () => {
        const withIds = finding({
            finding_id: "finding_with_ids",
            summary: "Release acceptance remains incomplete.",
            claimed_fact_ids: ["claim_readiness_0001"],
        });
        const withoutIds = finding({
            finding_id: "finding_without_ids",
            summary: "Release acceptance remains incomplete.",
        });
        const result = dedupeFindings({
            remaining_work: [withoutIds],
            readiness_gaps: [withIds],
            conflicts: [],
            limitations: [],
        });
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.remaining_work[0]!.isDuplicate).toBe(true);
        expect(result.remaining_work[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("collapses the SAME fact in the Limitations list too — the ticket's own 3-surface scenario", () => {
        const readinessGap = finding({
            finding_id: "finding_readiness_gap",
            summary: "Release acceptance remains incomplete.",
        });
        const result = dedupeFindings({
            remaining_work: [],
            readiness_gaps: [readinessGap],
            conflicts: [],
            limitations: ["Release acceptance remains incomplete."],
        });
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.limitations[0]!.isDuplicate).toBe(true);
        expect(result.limitations[0]!.primarySurface).toBe("readiness_gaps");
    });

    it("does NOT collapse two genuinely different findings", () => {
        const a = finding({
            finding_id: "finding_a",
            summary: "Release acceptance is incomplete.",
        });
        const b = finding({
            finding_id: "finding_b",
            summary: "CI pipeline success rate dropped.",
        });
        const result = dedupeFindings({
            remaining_work: [a],
            readiness_gaps: [b],
            conflicts: [],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(false);
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
    });

    it("every fact still appears SOMEWHERE — nothing is silently dropped from the returned arrays", () => {
        const a = finding({ finding_id: "finding_a", summary: "Same fact." });
        const b = finding({ finding_id: "finding_b", summary: "Same fact." });
        const c = finding({ finding_id: "finding_c", summary: "Same fact." });
        const result = dedupeFindings({
            remaining_work: [a],
            readiness_gaps: [b],
            conflicts: [c],
            limitations: ["Same fact."],
        });
        expect(result.remaining_work).toHaveLength(1);
        expect(result.readiness_gaps).toHaveLength(1);
        expect(result.conflicts).toHaveLength(1);
        expect(result.limitations).toHaveLength(1);
        // Exactly one primary among the four.
        const flags = [
            result.remaining_work[0]!.isDuplicate,
            result.readiness_gaps[0]!.isDuplicate,
            result.conflicts[0]!.isDuplicate,
            result.limitations[0]!.isDuplicate,
        ];
        expect(flags.filter((isDuplicate) => !isDuplicate)).toHaveLength(1);
        // readiness_gaps outranks remaining_work/conflicts/limitations.
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
    });

    /**
     * codex round 2, finding 1 (EXECUTED repro): matching on EITHER key
     * (text OR facts) let two DISTINCT facts collide purely because their
     * summaries happened to be worded identically, even though BOTH
     * carried their own distinct `claimed_fact_ids`. An explicit,
     * non-empty `claimed_fact_ids` on both sides is a stronger identity
     * signal than shared wording and must win: text-only matching is now
     * used ONLY when at least one side carries no id at all.
     */
    it("does NOT collapse two DIFFERENT facts that share identical text but carry distinct claimed_fact_ids (codex round 2, finding 1)", () => {
        const a = finding({
            finding_id: "finding_01",
            summary: "The release gate has not passed.",
            claimed_fact_ids: ["claim_01"],
        });
        const b = finding({
            finding_id: "finding_02",
            summary: "The release gate has not passed.",
            claimed_fact_ids: ["claim_02"],
        });
        const result = dedupeFindings({
            remaining_work: [b],
            readiness_gaps: [a],
            conflicts: [],
            limitations: [],
        });
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.remaining_work[0]!.isDuplicate).toBe(false);
        expect(result.remaining_work[0]!.primarySurface).toBe("remaining_work");
    });

    /**
     * codex round 2, finding 2 (EXECUTED repro): the old duplicate test was
     * `owner !== surface`, so a SECOND occurrence of the exact same fact
     * filed twice on the SAME surface resolved `owner === surface` and was
     * wrongly marked `isDuplicate: false` — both rendered in full. Identity
     * must collapse repeats within one surface too, not just across
     * surfaces.
     */
    it("marks a second identical fact within the SAME surface as a duplicate too (codex round 2, finding 2)", () => {
        const first = finding({
            finding_id: "finding_01",
            summary: "The release gate has not passed.",
            claimed_fact_ids: ["claim_01"],
        });
        const second = finding({
            finding_id: "finding_02",
            summary: "The release gate has not passed.",
            claimed_fact_ids: ["claim_01"],
        });
        const result = dedupeFindings({
            remaining_work: [],
            readiness_gaps: [first, second],
            conflicts: [],
            limitations: [],
        });
        expect(result.readiness_gaps[0]!.isDuplicate).toBe(false);
        expect(result.readiness_gaps[1]!.isDuplicate).toBe(true);
        expect(result.readiness_gaps[1]!.primarySurface).toBe("readiness_gaps");
    });

    /**
     * codex round 3, finding 1 (EXECUTED repro): the round-2 fix matched an
     * id-bearing finding ONLY by its facts key, ignoring text entirely —
     * correct when the id-less occurrence was claimed FIRST and processed
     * BEFORE the id-bearing one (the existing test below), but broken in
     * the OTHER order: an id-less finding processed first only registers
     * the text key, and a LATER id-bearing finding with the identical text
     * checked its facts key alone, found nothing, and became its own
     * (wrong) second primary. The merge must hold regardless of which
     * occurrence — id-bearing or id-less — is processed first.
     */
    it("still merges an id-less fact with a LATER id-bearing occurrence of the same text (codex round 3, finding 1)", () => {
        const idLessFirst = finding({
            finding_id: "finding_id_less",
            summary: "The release gate has not passed.",
        });
        const idBearingLater = finding({
            finding_id: "finding_id_bearing",
            summary: "The release gate has not passed.",
            claimed_fact_ids: ["claim_01"],
        });
        // remaining_work is processed before conflicts in SURFACE_PRIORITY,
        // so the id-less occurrence claims first.
        const result = dedupeFindings({
            remaining_work: [idLessFirst],
            readiness_gaps: [],
            conflicts: [idBearingLater],
            limitations: [],
        });
        expect(result.remaining_work[0]!.isDuplicate).toBe(false);
        expect(result.conflicts[0]!.isDuplicate).toBe(true);
        expect(result.conflicts[0]!.primarySurface).toBe("remaining_work");
    });

    it("conflicts outranks limitations when both carry the same fact and no Finding list ranks higher", () => {
        const c = finding({ finding_id: "finding_c", summary: "Same fact." });
        const result = dedupeFindings({
            remaining_work: [],
            readiness_gaps: [],
            conflicts: [c],
            limitations: ["Same fact."],
        });
        expect(result.conflicts[0]!.isDuplicate).toBe(false);
        expect(result.limitations[0]!.isDuplicate).toBe(true);
        expect(result.limitations[0]!.primarySurface).toBe("conflicts");
    });
});

/**
 * codex R4 pre-round sweep (chris/orchestrator, 2026-08-31 ~12:35 PDT):
 * three rounds each found a NEW edge case in this module's identity
 * matching, so instead of a fourth narrow-diff round, this exhausts the
 * decision space directly. `resolve()`'s decision procedure is per-item and
 * monotonic — each item is checked against the CURRENT claims map, built
 * from every STRICTLY EARLIER item's own claim, and nothing about a third
 * item's resolution depends on anything beyond "what has already been
 * claimed". That decomposes the whole module into a PAIRWISE truth table:
 * a `leader` (claims first) and a `follower` (resolves against whatever the
 * leader claimed) — every cell below is one leader/follower pairing.
 *
 * Dimensions: leader id-bearing or id-less × follower id-bearing or
 * id-less × identical text or not × (when both id-bearing) their id sets
 * EQUAL / DISJOINT / OVERLAPPING / SUBSET × same or different surface.
 *
 * AMBIGUOUS CELL, flagged rather than guessed (per standing instruction):
 * OVERLAPPING and SUBSET id sets with identical text. The current
 * implementation's identity model treats `claimed_fact_ids` as a single
 * opaque SET key — two DIFFERENT sets are a different identity full stop,
 * with no notion of "close enough" for a partial overlap or a subset. That
 * is a defensible reading (an overlapping-but-different citation set is
 * evidentially a different claim), but nothing in the schema or ticket
 * text confirms it, and it is a genuinely different question from the
 * DISJOINT-set cell (round 2, finding 1), which is unambiguous (visibly
 * unrelated ids sharing text must not collapse). The two cells below pin
 * the CURRENT behavior (not deduplicated) as the reviewed baseline, not as
 * a confirmed product decision — this is the cell to bring to chris if a
 * real investigation ever produces overlapping/subset `claimed_fact_ids`
 * with identical wording.
 */
describe("dedupeFindings: exhaustive pairwise truth table (codex R4 pre-round sweep)", () => {
    function pairFinding(id: string, text: string, ids?: readonly string[]): Finding {
        return finding({
            finding_id: id,
            summary: text,
            ...(ids !== undefined ? { claimed_fact_ids: [...ids] } : {}),
        });
    }

    /** `leader` is always placed on the higher-priority surface (readiness_gaps) so it claims first. */
    function resolvePair(
        leaderIds: readonly string[] | undefined,
        followerIds: readonly string[] | undefined,
        sameText: boolean,
        sameSurface = false,
    ): boolean {
        const leaderText = "The release gate has not passed.";
        const followerText = sameText ? leaderText : "CI pipeline success rate dropped.";
        const leader = pairFinding("leader", leaderText, leaderIds);
        const follower = pairFinding("follower", followerText, followerIds);
        const result = sameSurface
            ? dedupeFindings({
                  remaining_work: [],
                  readiness_gaps: [leader, follower],
                  conflicts: [],
                  limitations: [],
              })
            : dedupeFindings({
                  remaining_work: [],
                  readiness_gaps: [leader],
                  conflicts: [follower],
                  limitations: [],
              });
        return sameSurface
            ? result.readiness_gaps[1]!.isDuplicate
            : result.conflicts[0]!.isDuplicate;
    }

    type Cell = {
        readonly name: string;
        readonly leaderIds?: readonly string[];
        readonly followerIds?: readonly string[];
        readonly sameText: boolean;
        readonly expectDuplicate: boolean;
    };

    const CROSS_SURFACE_CELLS: readonly Cell[] = [
        { name: "id-less x id-less, same text", sameText: true, expectDuplicate: true },
        { name: "id-less x id-less, different text", sameText: false, expectDuplicate: false },
        {
            name: "id-less leader x id-bearing follower, same text (round 3 finding 1)",
            followerIds: ["A"],
            sameText: true,
            expectDuplicate: true,
        },
        {
            name: "id-less leader x id-bearing follower, different text",
            followerIds: ["A"],
            sameText: false,
            expectDuplicate: false,
        },
        {
            name: "id-bearing leader x id-less follower, same text (round 1 finding 3)",
            leaderIds: ["A"],
            sameText: true,
            expectDuplicate: true,
        },
        {
            name: "id-bearing leader x id-less follower, different text",
            leaderIds: ["A"],
            sameText: false,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, EQUAL ids, same text",
            leaderIds: ["A"],
            followerIds: ["A"],
            sameText: true,
            expectDuplicate: true,
        },
        {
            name: "id-bearing x id-bearing, EQUAL ids, different text (id wins over text)",
            leaderIds: ["A"],
            followerIds: ["A"],
            sameText: false,
            expectDuplicate: true,
        },
        {
            name: "id-bearing x id-bearing, DISJOINT ids, same text (round 2 finding 1)",
            leaderIds: ["A"],
            followerIds: ["B"],
            sameText: true,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, DISJOINT ids, different text",
            leaderIds: ["A"],
            followerIds: ["B"],
            sameText: false,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, OVERLAPPING ids ({A,B} vs {B,C}), same text — AMBIGUOUS, see describe-block note",
            leaderIds: ["A", "B"],
            followerIds: ["B", "C"],
            sameText: true,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, OVERLAPPING ids, different text",
            leaderIds: ["A", "B"],
            followerIds: ["B", "C"],
            sameText: false,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, SUBSET ids ({A} vs {A,B}), same text — AMBIGUOUS, see describe-block note",
            leaderIds: ["A"],
            followerIds: ["A", "B"],
            sameText: true,
            expectDuplicate: false,
        },
        {
            name: "id-bearing x id-bearing, SUBSET ids, different text",
            leaderIds: ["A"],
            followerIds: ["A", "B"],
            sameText: false,
            expectDuplicate: false,
        },
    ];

    it.each(CROSS_SURFACE_CELLS)("cross-surface cell: $name", (cell) => {
        expect(resolvePair(cell.leaderIds, cell.followerIds, cell.sameText)).toBe(
            cell.expectDuplicate,
        );
    });

    const SAME_SURFACE_CELLS: readonly Cell[] = [
        { name: "id-less x id-less, same text", sameText: true, expectDuplicate: true },
        {
            name: "id-bearing x id-bearing, equal ids (round 2 finding 2)",
            leaderIds: ["A"],
            followerIds: ["A"],
            sameText: true,
            expectDuplicate: true,
        },
    ];

    it.each(SAME_SURFACE_CELLS)("same-surface cell: $name", (cell) => {
        expect(resolvePair(cell.leaderIds, cell.followerIds, cell.sameText, true)).toBe(
            cell.expectDuplicate,
        );
    });
});

describe("identityLimitations: no cross-surface dedup context (clarification branch)", () => {
    it("marks every limitation as its own primary", () => {
        const result = identityLimitations(["a", "b"]);
        expect(result).toEqual([
            { text: "a", isDuplicate: false, primarySurface: "limitations" },
            { text: "b", isDuplicate: false, primarySurface: "limitations" },
        ]);
    });
});
