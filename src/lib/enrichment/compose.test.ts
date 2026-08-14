import { describe, expect, it } from "vitest";

import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";
import { buildComposition } from "@/lib/enrichment/compose";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import { validateEnrichment } from "@/lib/enrichment/validate";
import { mockScenarios } from "@/test/fixtures/investigations";

const canonical = canonicalResult as unknown as InvestigationResult;

function validate(result: InvestigationResult) {
    return validateEnrichment(
        buildComposition(result, PRESENTATION_MANIFEST_V1),
        result,
        PRESENTATION_MANIFEST_V1,
    );
}

describe("composition builder — it must never drift from the validator", () => {
    /**
     * The constraint that matters. A builder emitting compositions its own
     * validator rejects is a silent desync: the enriched view would fall back
     * every time, which always LOOKS like the safe outcome, so nothing would
     * complain. Running the builder's output through the real validator on
     * every result shape is what keeps the two honest about each other.
     */
    it("emits a composition the fail-closed validator accepts, for every result shape", () => {
        const shapes: readonly [string, InvestigationResult][] = [
            ["canonical", canonical],
            ...mockScenarios().map(
                (scenario) => [scenario.id, scenario.result] as [string, InvestigationResult],
            ),
        ];

        for (const [name, result] of shapes) {
            const validation = validate(result);
            expect(
                validation.ok,
                validation.ok ? "" : `${name}: ${JSON.stringify(validation.violations)}`,
            ).toBe(true);
        }
    });

    /**
     * The empty shapes are where an index-out-of-range reference would appear,
     * and an unresolvable reference is exactly what the validator would reject.
     */
    it("holds for a result with nothing in any collection", () => {
        const bare: InvestigationResult = {
            ...canonical,
            direct_judgment: "",
            current_state: "",
            strongest_pressures: [],
            drivers: [],
            remaining_work: [],
            readiness_gaps: [],
            paths: [],
            conflicts: [],
            claimed_facts: [],
            evidence_ref_ids: [],
            limitations: [],
            warnings: [],
            coverage: { sources: [], partial: false, degraded_reasons: [] },
        };

        const validation = validate(bare);
        expect(validation.ok, validation.ok ? "" : JSON.stringify(validation.violations)).toBe(
            true,
        );
    });
});

describe("composition builder — what it emits", () => {
    it("emits only references, never a literal material value", () => {
        const composition = buildComposition(canonical, PRESENTATION_MANIFEST_V1);

        // Every quoted string in the program must be a reference. Any other
        // quoted string would be the builder authoring content.
        const quoted = composition.match(/"[^"]*"/gu) ?? [];
        expect(quoted.length).toBeGreaterThan(0);
        for (const literal of quoted) {
            expect(literal, `not a reference: ${literal}`).toMatch(/^"@result\./u);
        }
    });

    it("carries no prose from the result into the composition itself", () => {
        const composition = buildComposition(canonical, PRESENTATION_MANIFEST_V1);

        for (const text of [
            canonical.deterministic_answer,
            canonical.direct_judgment,
            ...canonical.drivers.map((driver) => driver.title),
            ...canonical.limitations,
        ]) {
            expect(composition).not.toContain(text);
        }
    });

    it("always emits the mandatory sections, even when their arrays are empty", () => {
        const bare: InvestigationResult = {
            ...canonical,
            limitations: [],
            coverage: { sources: [], partial: false, degraded_reasons: [] },
        };
        const composition = buildComposition(bare, PRESENTATION_MANIFEST_V1);

        // "No limitations were reported" and "limitations were not shown" must
        // never look the same.
        expect(composition).toContain("Coverage(");
        expect(composition).toContain("Limitations(");
    });

    it("starts at root, as OpenUI Lang requires", () => {
        expect(
            buildComposition(canonical, PRESENTATION_MANIFEST_V1).startsWith("root = Answer("),
        ).toBe(true);
    });

    it("is deterministic — the same result yields the same composition", () => {
        expect(buildComposition(canonical, PRESENTATION_MANIFEST_V1)).toBe(
            buildComposition(canonical, PRESENTATION_MANIFEST_V1),
        );
    });

    it("honours its caps so a large result cannot produce an unbounded view", () => {
        const composition = buildComposition(canonical, PRESENTATION_MANIFEST_V1, {
            maxDrivers: 0,
            maxFindings: 0,
            maxPaths: 0,
        });

        expect(composition).not.toContain("DriverCard(");
        expect(composition).not.toContain("FindingCard(");
        expect(composition).not.toContain("RelationshipPathView(");
        // The mandatory sections survive the caps.
        expect(composition).toContain("Coverage(");
        expect(composition).toContain("Limitations(");
    });
});
