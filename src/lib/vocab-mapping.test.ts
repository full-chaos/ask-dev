import { describe, expect, it } from "vitest";

import {
    CANNOT_REASK_HERE_COPY,
    factKindVocabulary,
    humanizeCoverageSourceName,
    humanizeDegradedReason,
    humanizeEvidenceRefId,
    humanizeReasonBody,
} from "@/lib/vocab-mapping";

/**
 * CHAOS-4673. Every real shape here is traced to its acr producer (never
 * invented, same CHAOS-2225 discipline `src/test/fixtures/investigations.ts`
 * documents for itself):
 *   - `pruned:subject_kind_unsupported`/`narrowed:subject_kind_unsupported`/
 *     `unexpanded:<outcome>` — `acr/internal/contextfabric/fact_planner.go`
 *     (`prunedReason`/`narrowedReason`/`unexpandedReason`).
 *   - the `"<kind>: "` degraded-reason prefix — `fact_registry.go`'s
 *     `appendFactCoverage`.
 *   - `acr:v1:<entity-type>:<id>` — `internal/contextpacket/source_queries.go`.
 */
describe("vocab-mapping: degraded reasons", () => {
    it("maps the exact raw string chris's UX notes reported (unexpanded:policy_unavailable)", () => {
        const raw =
            "blockers: unexpanded:policy_unavailable: no resolved subject holds this capability's facts directly and scope expansion did not reach them (origin: team; supported: work_item; policy: none; basis: activity_proxy)";
        const result = humanizeDegradedReason(raw);
        expect(result.mapped).toBe(true);
        expect(result.raw).toBe(raw);
        // Never a raw closed-vocabulary token on the lead surface.
        expect(result.sentence).not.toMatch(/unexpanded:/);
        expect(result.sentence).not.toMatch(/policy_unavailable/);
        expect(result.sentence).not.toMatch(/activity_proxy/);
        // Reads as a plain sentence (acceptance: "every degraded reason
        // reads as a plain sentence").
        expect(result.sentence).toMatch(/^Blockers: /);
        expect(result.sentence).toMatch(/no data-sharing policy is configured/);
        expect(result.sentence).toMatch(/recent activity, not a confirmed link/);
    });

    it("maps a pruned:subject_kind_unsupported source reason (the pinned fixture's own shape)", () => {
        const raw =
            "pruned:subject_kind_unsupported: no resolved subject has a kind this capability supports";
        const result = humanizeReasonBody(raw);
        expect(result.mapped).toBe(true);
        expect(result.sentence).not.toMatch(/pruned:|subject_kind_unsupported/);
        expect(result.sentence).toBe(
            "This source doesn't cover the kind of thing being asked about.",
        );
    });

    it("maps a narrowed:subject_kind_unsupported reason and keeps the subject count", () => {
        const raw =
            "narrowed:subject_kind_unsupported: 3 subject(s) were not queried because this capability does not support their kind (skipped: incident; supported: work_item)";
        const result = humanizeReasonBody(raw);
        expect(result.mapped).toBe(true);
        expect(result.sentence).toMatch(/^3 subjects were skipped/);
        expect(result.sentence).not.toMatch(/narrowed:/);
    });

    it("keeps a recognized prefix's sentence even when the parenthetical detail is missing", () => {
        // Defends the "classify by prefix, not by matching the WHOLE format
        // string" design (doc comment) -- a producer that reorders or drops
        // a field must not turn a recognized reason into a leaked one.
        const raw = "unexpanded:failed";
        const result = humanizeReasonBody(raw);
        expect(result.mapped).toBe(true);
        expect(result.sentence).toMatch(/search to reach it failed/);
    });

    /**
     * `acr/internal/contextfabric/falkorgraph/reader.go` emits these FOUR
     * codes straight into `degraded_reasons[]` with no `"<kind>: "` prefix
     * (it does not route through `appendFactCoverage`) — a distinct shape
     * from the fact-planner reasons above, easy to miss if only the
     * kind-prefixed shape is tested.
     */
    it("maps the graph reader's own bare degraded-reason codes", () => {
        const endpointFailed = humanizeReasonBody("endpoint_lookup_failed:3");
        expect(endpointFailed.mapped).toBe(true);
        expect(endpointFailed.sentence).toBe(
            "3 relationship links in the graph could not be resolved.",
        );

        const truncated = humanizeReasonBody("exact_name_candidates_truncated");
        expect(truncated.mapped).toBe(true);
        expect(truncated.sentence).not.toContain("exact_name_candidates_truncated");

        const deniedSingular = humanizeReasonBody("cohort_denied_by_authorization:1");
        expect(deniedSingular.mapped).toBe(true);
        expect(deniedSingular.sentence).toBe(
            "1 member of this group was left out because this account isn't authorized to see it.",
        );

        const unknownRelType = humanizeReasonBody("unknown_relationship_type:2");
        expect(unknownRelType.mapped).toBe(true);
        expect(unknownRelType.sentence).toContain("2 relationship edges");
    });

    it("fails READABLE (generic phrase + raw preserved), never leaky, on an unrecognized shape", () => {
        const raw = "some_future_acr_reason: nothing this module has ever seen";
        const degraded = humanizeDegradedReason(raw);
        expect(degraded.mapped).toBe(false);
        expect(degraded.raw).toBe(raw);
        expect(degraded.sentence.length).toBeGreaterThan(0);
        expect(degraded.sentence).not.toContain(raw);

        const bare = humanizeReasonBody("totally-unrecognized-shape");
        expect(bare.mapped).toBe(false);
        expect(bare.sentence.length).toBeGreaterThan(0);
    });

    it("only strips the kind prefix when it is a real FactKind (schema-closed, never hand-guessed)", () => {
        expect(factKindVocabulary.size).toBeGreaterThan(0);
        expect(factKindVocabulary.has("blockers")).toBe(true);

        // "not_a_real_kind" is not in the vocabulary -- must not be treated
        // as a kind prefix (would misparse the reason body).
        const raw = "not_a_real_kind: unexpanded:failed";
        const result = humanizeDegradedReason(raw);
        // Falls through to the bare-body parse of the WHOLE string, which
        // does not start with a known prefix either -- generic, not leaky.
        // Exact-value pinned (not just "doesn't contain the raw token"): a
        // weaker substring check here does not actually kill the mutant
        // that drops the FactKind gate and instead treats
        // "not_a_real_kind" as a real kind prefix -- humanizeTerm() turns
        // underscores into spaces, so that mutant's sentence ("Not a real
        // kind: ...") also happens not to contain the literal
        // "not_a_real_kind" substring and a substring-only assertion here
        // stayed green under it (caught by re-mutation, cf-common's
        // mutation-proof rule).
        expect(result).toStrictEqual({
            sentence: "This source didn't fully contribute; see details for the reason.",
            raw,
            mapped: false,
        });
    });
});

describe("vocab-mapping: coverage source names", () => {
    it("maps canonical_fact:<kind>", () => {
        const result = humanizeCoverageSourceName("canonical_fact:blockers");
        expect(result.mapped).toBe(true);
        expect(result.raw).toBe("canonical_fact:blockers");
        expect(result.sentence).not.toContain("canonical_fact:");
        expect(result.sentence).toMatch(/blockers/);
    });

    it("maps dev-health-ops:<capability>", () => {
        const result = humanizeCoverageSourceName("dev-health-ops:readiness");
        expect(result.mapped).toBe(true);
        expect(result.sentence).not.toContain("dev-health-ops:");
    });

    it("maps the fixed context-fabric:graph source", () => {
        const result = humanizeCoverageSourceName("context-fabric:graph");
        expect(result.mapped).toBe(true);
        expect(result.sentence).toBe("Relationship graph");
    });

    it("maps the distinct context-fabric:graph-validity-windows source (falkorgraph/reader.go)", () => {
        const result = humanizeCoverageSourceName("context-fabric:graph-validity-windows");
        expect(result.mapped).toBe(true);
        expect(result.sentence).not.toBe("Relationship graph");
        expect(result.sentence).toContain("Relationship graph");
    });

    it("fails readable on an unrecognized source name", () => {
        const result = humanizeCoverageSourceName("some-future-source:x");
        expect(result.mapped).toBe(false);
        expect(result.raw).toBe("some-future-source:x");
        expect(result.sentence).not.toContain("some-future-source:x");
    });

    /**
     * codex round 1, finding 4 (EXECUTED repro): `coverage.sources[].source`
     * is free text on the wire (not a closed enum), so treating any
     * non-empty suffix after `canonical_fact:` as "mapped" let a bogus kind
     * leak onto the visible chip verbatim (codex's own repro embedded
     * `unexpanded:policy_unavailable` as the "kind", and it survived
     * straight through `humanizeTerm`, which only replaces underscores).
     * Only a real, schema-declared FactKind counts as mapped now.
     */
    it("fails readable when the suffix after canonical_fact:/dev-health-ops: is not a real FactKind", () => {
        const bogusKind = humanizeCoverageSourceName(
            "canonical_fact:unexpanded:policy_unavailable",
        );
        expect(bogusKind.mapped).toBe(false);
        expect(bogusKind.sentence).not.toContain("unexpanded:");
        expect(bogusKind.sentence).not.toContain("policy_unavailable");
        expect(bogusKind.raw).toBe("canonical_fact:unexpanded:policy_unavailable");

        const bogusOpsKind = humanizeCoverageSourceName("dev-health-ops:not_a_real_capability");
        expect(bogusOpsKind.mapped).toBe(false);
        expect(bogusOpsKind.sentence).not.toContain("not_a_real_capability");
    });
});

describe("vocab-mapping: evidence reference ids", () => {
    it("maps the exact acr:v1:team ids chris's UX notes reported", () => {
        const teamChaos = humanizeEvidenceRefId("acr:v1:team:CHAOS");
        expect(teamChaos.mapped).toBe(true);
        expect(teamChaos.sentence).toBe("Team: CHAOS");
        expect(teamChaos.raw).toBe("acr:v1:team:CHAOS");

        // The id itself may contain ':' (a compound key) -- must not be
        // truncated at the first colon after the entity type.
        const teamGh = humanizeEvidenceRefId("acr:v1:team:gh:ops-team");
        expect(teamGh.mapped).toBe(true);
        expect(teamGh.sentence).toBe("Team: gh:ops-team");
        expect(teamGh.raw).toBe("acr:v1:team:gh:ops-team");
    });

    it("maps a real producer shape (acr:v1:pull-request:<n>)", () => {
        const result = humanizeEvidenceRefId("acr:v1:pull-request:482");
        expect(result.mapped).toBe(true);
        expect(result.sentence).toBe("Pull request: 482");
    });

    it("fails readable on a non-acr:v1 or unrecognized-entity-type id", () => {
        const notAcr = humanizeEvidenceRefId("evidence_release_acceptance");
        expect(notAcr.mapped).toBe(false);
        expect(notAcr.raw).toBe("evidence_release_acceptance");
        expect(notAcr.sentence).not.toContain("evidence_release_acceptance");

        const unknownEntity = humanizeEvidenceRefId("acr:v1:some-new-entity:42");
        expect(unknownEntity.mapped).toBe(false);
        expect(unknownEntity.raw).toBe("acr:v1:some-new-entity:42");
    });
});

describe("vocab-mapping: implementation-state copy", () => {
    it("the cannot-reask copy names no implementation detail", () => {
        expect(CANNOT_REASK_HERE_COPY).not.toMatch(/context|inspection/i);
    });
});
