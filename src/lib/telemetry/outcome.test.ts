import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult, StructureNeedKind } from "@/lib/contracts";
import {
    boundedCoverageSource,
    buildOutcomeEvent,
    buildStructureOfferSelectionEvent,
    UNRECOGNIZED_SOURCE,
} from "@/lib/telemetry/outcome";

const result = canonicalResult as unknown as InvestigationResult;

/**
 * Every free-text field the result carries. If any of these strings appears in
 * a serialized event, telemetry has become data egress.
 */
function prose(source: InvestigationResult): readonly string[] {
    return [
        source.question,
        source.deterministic_answer,
        source.direct_judgment,
        source.current_state,
        ...source.strongest_pressures,
        ...source.limitations,
        ...source.warnings,
        ...source.drivers.flatMap((driver) => [
            driver.title,
            driver.summary,
            ...(driver.qualification === undefined ? [] : [driver.qualification]),
        ]),
        ...source.remaining_work.map((finding) => finding.summary),
        ...source.subject_resolution.committed.map((subject) => subject.label),
        ...source.subject_resolution.candidates.flatMap((candidate) => [
            candidate.subject.label,
            ...candidate.match_reasons,
        ]),
        ...source.paths.flatMap((path) =>
            path.why_relevant === undefined ? [] : [path.why_relevant],
        ),
        // Model-derived: the contract bounds it only to a string.
        source.interpretation.requested_judgment,
        // Coverage source names are unbounded on the wire. Only the ones that
        // fall OUTSIDE the known vocabulary count as free text — a recognized
        // name is a bounded token and is deliberately retained, exactly like a
        // coverage state.
        ...source.coverage.sources
            .map((coverageSource) => coverageSource.source)
            .filter((name) => boundedCoverageSource(name) === UNRECOGNIZED_SOURCE),
    ].filter((value) => typeof value === "string" && value.trim() !== "");
}

describe("outcome telemetry — content safety", () => {
    /**
     * The property that matters. The Workbench answers questions about real
     * projects, teams and people; an event carrying the question, the answer, a
     * subject label or a driver summary would turn observability into egress.
     */
    it("carries no free text from the result", () => {
        const event = buildOutcomeEvent({
            latencyMs: 1234,
            renderSurface: "deterministic",
            result,
        });
        const serialized = JSON.stringify(event);

        for (const text of prose(result)) {
            expect(serialized, `leaked: ${text.slice(0, 60)}`).not.toContain(text);
        }
    });

    it("carries no subject labels or canonical ids", () => {
        const event = buildOutcomeEvent({
            latencyMs: 10,
            renderSurface: "enriched",
            result,
        });
        const serialized = JSON.stringify(event);

        for (const subject of result.subject_resolution.committed) {
            expect(serialized).not.toContain(subject.label);
            expect(serialized).not.toContain(subject.canonical_id);
        }
    });

    /**
     * A negative control for the check above: the leak detector must be capable
     * of failing. Without this, `not.toContain` passing would prove nothing —
     * it would pass just as happily against an empty object.
     */
    it("the leak detector actually detects a leak", () => {
        const leaky = JSON.stringify({
            ...buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result }),
            oops: result.deterministic_answer,
        });
        expect(leaky).toContain(result.deterministic_answer);
    });
});

describe("outcome telemetry — what it does record", () => {
    it("records the question FAMILY, not the question", () => {
        const event = buildOutcomeEvent({
            latencyMs: 1,
            renderSurface: "deterministic",
            result,
        });

        expect(event.questionShape).toBe(result.interpretation.shape);
        expect(JSON.stringify(event)).not.toContain(result.question);
        // requested_judgment is model-derived free text (the contract bounds it
        // only to a 256-character string), so it must not appear at all.
        expect(JSON.stringify(event)).not.toContain(result.interpretation.requested_judgment);
    });

    /**
     * R2. The schema types `coverage.sources[].source` as a 1..128 character
     * string, so it is free text on the wire however identifier-shaped it
     * usually looks. The count is preserved; the string is not.
     */
    it("drops an unrecognized coverage source name but keeps the count", () => {
        const smuggled = "the model said Ask Dev is ready to ship";
        const tainted: InvestigationResult = {
            ...result,
            coverage: {
                ...result.coverage,
                sources: [
                    { source: smuggled, state: "available" },
                    { source: "canonical_fact:metrics", state: "stale" },
                ],
            },
        };

        const event = buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result: tainted });

        expect(JSON.stringify(event)).not.toContain(smuggled);
        expect(event.coverageSourceStates).toEqual([
            { source: "canonical_fact:metrics", state: "stale" },
            { source: "other", state: "available" },
        ]);
        expect(event.unknownSourceCount).toBe(1);
    });

    /**
     * X1. Deduplicating sources and states independently destroyed both the
     * pairing and the count: two unrecognized sources in different states
     * became one "other" beside two unrelated states, so neither "which state
     * was that source in" nor "how many were unrecognized" survived — the very
     * count-preservation the mapping was supposed to guarantee.
     */
    it("keeps two unrecognized sources distinguishable and countable", () => {
        const tainted: InvestigationResult = {
            ...result,
            coverage: {
                ...result.coverage,
                sources: [
                    { source: "mystery-one", state: "available" },
                    { source: "mystery-two", state: "stale" },
                ],
            },
        };

        const event = buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result: tainted });

        // Two entries, not one: the states remain attached to their own source.
        expect(event.coverageSourceStates).toEqual([
            { source: "other", state: "available" },
            { source: "other", state: "stale" },
        ]);
        expect(event.unknownSourceCount).toBe(2);
        expect(JSON.stringify(event)).not.toContain("mystery");
    });

    it("keeps source names that are in the known vocabulary", () => {
        expect(boundedCoverageSource("canonical_fact:workload")).toBe("canonical_fact:workload");
        expect(boundedCoverageSource("dev-health-ops:status")).toBe("dev-health-ops:status");
        expect(boundedCoverageSource("context-fabric:graph")).toBe("context-fabric:graph");
        // A plausible-looking prefix with an unknown kind is still unknown.
        expect(boundedCoverageSource("canonical_fact:not_a_kind")).toBe("other");
    });

    it("records coverage as closed-vocabulary states and counts", () => {
        const event = buildOutcomeEvent({
            latencyMs: 1,
            renderSurface: "deterministic",
            result,
        });

        // Asserted against the pinned example's OWN source/state pairs, in
        // order, rather than against two hand-named states: the literal pair
        // this used to check ("pruned"/"available") was a fact about which
        // states the example happened to carry, and the CHAOS-4449 pin bump
        // flipped its `canonical_fact:workload` source from `pruned` to
        // `available` — failing a test that was never about that source. The
        // multiset comparison is strictly stronger than the two `toContain`s
        // it replaces: it catches a dropped, duplicated, or substituted
        // entry, and it pins the source↔state PAIRING this event exists to
        // preserve. Compared as a multiset, not a sequence, because the event
        // sorts by (source, state); that sort, mixed states, and the
        // unknown-source bounding all stay pinned by the constructed-result
        // test above, which does not depend on the example's own contents.
        const asMultiset = (pairs: readonly { source: string; state: string }[]) =>
            pairs.map((pair) => `${pair.source}|${pair.state}`).sort();

        expect(event.coverageSourceStates).toHaveLength(result.coverage.sources.length);
        expect(asMultiset(event.coverageSourceStates)).toEqual(
            asMultiset(
                result.coverage.sources.map((source) => ({
                    source: boundedCoverageSource(source.source),
                    state: source.state,
                })),
            ),
        );
        expect(event.coveragePartial).toBe(result.coverage.partial);
        expect(event.limitationCount).toBe(result.limitations.length);
        expect(event.evidenceRefCount).toBe(result.evidence_ref_ids.length);
        expect(event.driverCount).toBe(result.drivers.length);
    });

    it("records provenance versions", () => {
        const event = buildOutcomeEvent({
            latencyMs: 1,
            renderSurface: "deterministic",
            result,
        });

        expect(event.backend).toBe(result.versions.backend);
        expect(event.projectionVersion).toBe(result.versions.projection_version);
        expect(event.queryVersion).toBe(result.versions.query_version);
        expect(event.reused).toBe(result.reused);
    });

    it("records a failure as an outcome in its own right", () => {
        const event = buildOutcomeEvent({
            latencyMs: 16_777,
            renderSurface: "deterministic",
            failureCode: "acr_investigation_failed",
            upstreamStatus: 500,
        });

        expect(event.outcome).toBe("failed");
        expect(event.failureCode).toBe("acr_investigation_failed");
        expect(event.upstreamStatus).toBe(500);
        expect(event.resultStatus).toBeUndefined();
        // Counts must not silently read as "zero findings" when there was no
        // result at all — the outcome field is what distinguishes them.
        expect(event.driverCount).toBe(0);
    });

    it("distinguishes no-choice from an ignored choice", () => {
        // undefined and false must not aggregate together: "there was no choice
        // to honour" and "the choice was silently discarded" are different
        // facts about a run.
        expect(
            buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result })
                .clarificationChoiceHonoured,
        ).toBeUndefined();
        expect(
            buildOutcomeEvent({
                latencyMs: 1,
                renderSurface: "raw",
                result,
                clarificationChoiceCarried: true,
                clarificationChoiceHonoured: false,
            }).clarificationChoiceHonoured,
        ).toBe(false);
    });

    it("records an enrichment fallback and the predicates that caused it", () => {
        const event = buildOutcomeEvent({
            latencyMs: 5,
            renderSurface: "deterministic",
            result,
            enrichmentFellBack: true,
            enrichmentFallbackPredicates: ["material_prop_not_a_reference", "query_statements"],
        });

        expect(event.enrichmentFellBack).toBe(true);
        expect(event.enrichmentFallbackPredicates).toEqual([
            "material_prop_not_a_reference",
            "query_statements",
        ]);
    });

    it("distinguishes clarification and no-match from a plain answer", () => {
        const clarify = { ...result, status: "clarification_required" as const };
        const noMatch = { ...result, status: "no_match" as const };

        expect(
            buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result: clarify }).outcome,
        ).toBe("clarification_required");
        expect(
            buildOutcomeEvent({ latencyMs: 1, renderSurface: "raw", result: noMatch }).outcome,
        ).toBe("no_match");
    });
});

/**
 * CHAOS-4171 standing order: structure-offer selection telemetry, symmetric
 * across all five offer members (the four that predate CHAOS-4012 had none
 * either — this closes that gap for all five, not just the new one).
 */
describe("buildStructureOfferSelectionEvent", () => {
    const MEMBERS: readonly StructureNeedKind[] = [
        "expected_kind",
        "subject_anchor",
        "subject_handle",
        "window",
        "subject_candidate",
    ];

    for (const member of MEMBERS) {
        it(`records a submitted outcome for ${member}`, () => {
            expect(buildStructureOfferSelectionEvent(member, "submitted")).toEqual({
                event: "workbench_structure_offer_selection",
                member,
                outcome: "submitted",
            });
        });

        it(`records a rejected_malformed outcome for ${member}`, () => {
            expect(buildStructureOfferSelectionEvent(member, "rejected_malformed")).toEqual({
                event: "workbench_structure_offer_selection",
                member,
                outcome: "rejected_malformed",
            });
        });
    }

    it("carries only the closed member/outcome vocabulary — no option id, label, or receipt", () => {
        const event = buildStructureOfferSelectionEvent("subject_candidate", "submitted");

        expect(Object.keys(event).sort()).toEqual(["event", "member", "outcome"]);
    });
});
