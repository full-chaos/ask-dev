import { describe, expect, it } from "vitest";

import { validateContract } from "@/lib/acr/validate";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

const RESULT_SCHEMA = "context_fabric_investigation_result.v1.schema.json";

/**
 * THE SEAM landed (acr 7d275c2e; `@/lib/contracts`'s own header):
 * `structure_needs`/`confirmed_structure`/`structure_offer_snapshot`/
 * `window_clarification` are now real fields on the pinned contract, so
 * every structure-needs fixture validates directly against the SAME
 * `context_fabric_investigation_result.v1.schema.json` `investigations.ts`'s
 * own fixtures do — no staging schema, no fragment-stripping. Mirrors
 * `investigations.test.ts`'s own discipline: schema validity plus negative
 * controls that prove an invented vocabulary term (or an out-of-bound value)
 * is actually rejected, not merely absent from the fixtures by omission.
 */
describe("every structure-needs fixture round-trips against the pinned contract", () => {
    for (const scenario of structureMockScenarios()) {
        it(`${scenario.id} validates`, () => {
            const validation = validateContract(RESULT_SCHEMA, scenario.result);
            expect(validation.valid, validation.errors.join("; ")).toBe(true);
        });
    }
});

describe("schema validation negative controls: the pinned contract actually rejects invented structure vocabulary", () => {
    // The red half of red->green. If the validator ever stops rejecting
    // these, the round-trip test above proves nothing.

    function taintedBase(): Record<string, unknown> {
        const base = structureMockScenarios().find((scenario) => scenario.id === "structure-kind");
        if (base === undefined) throw new Error("missing structure-kind fixture");
        return structuredClone(base.result);
    }

    it("rejects an invented StructureNeedKind in `missing`", () => {
        const tainted = taintedBase();
        (tainted["structure_needs"] as { missing: string[] }).missing = ["subject_repository"];

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
    });

    it("rejects an invented StructureDisposition on a confirmed_structure entry", () => {
        const tainted = taintedBase();
        tainted["confirmed_structure"] = [
            {
                member: "expected_kind",
                applied_value: "pull_request",
                source: "receipt",
                prior_result_id: "result_structure_kind_0001",
                receipt_id: "kindr_pull_request_0001",
                provenance: "clarification_confirmed",
                disposition: "silently_dropped",
            },
        ];

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
    });

    it("rejects a kind_options entry whose receipt_id is outside the kindr_ namespace", () => {
        const tainted = taintedBase();
        (
            tainted["structure_needs"] as {
                kind_options: { receipt_id: string }[];
            }
        ).kind_options[0]!.receipt_id = "ancr_wrong_namespace_0001";

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
    });

    it("rejects an additional property on a confirmed_structure entry", () => {
        const tainted = taintedBase();
        tainted["confirmed_structure"] = [
            {
                member: "expected_kind",
                applied_value: "pull_request",
                source: "receipt",
                prior_result_id: "result_structure_kind_0001",
                receipt_id: "kindr_pull_request_0001",
                provenance: "clarification_confirmed",
                disposition: "applied",
                invented_field: "should not be allowed",
            },
        ];

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
    });

    /**
     * CHAOS-3927 P2 shipped `matched_term_hash` provisionally, typed as a
     * bare `string` with no committed bound (the field had not yet landed
     * acr-side — see the fixture's own comment on this value). THE SEAM
     * revealed the real bound: exactly 24 lowercase hex chars
     * (`^[0-9a-f]{24}$`). This control proves the pinned schema actually
     * enforces that bound now — the drift this file's own fixture carried
     * until this pin bump (a 64-char sha256 hex digest) would have passed
     * silently before, and must not again.
     */
    it("rejects an AnchorOption.matched_term_hash outside the pinned 24-hex bound", () => {
        const anchorScenario = structureMockScenarios().find(
            (scenario) => scenario.id === "structure-anchor-window",
        );
        if (anchorScenario === undefined)
            throw new Error("missing structure-anchor-window fixture");
        const tainted = structuredClone(anchorScenario.result) as Record<string, unknown>;
        (
            tainted["structure_needs"] as {
                anchor_options: { matched_term_hash: string }[];
            }
        ).anchor_options[0]!.matched_term_hash =
            "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

        const validation = validateContract(RESULT_SCHEMA, tainted);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join("; ")).toContain("matched_term_hash");
    });
});
