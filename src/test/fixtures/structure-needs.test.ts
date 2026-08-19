import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import stagingSchema from "@/lib/pivot/structure-needs.pending-p1.schema.json";
import { validateContract } from "@/lib/acr/validate";
import { structureMockScenarios } from "@/test/fixtures/structure-needs";

/**
 * Validates the P1(+W1) fragment of every structure-needs fixture against
 * the STAGING schema (`@/lib/pivot/structure-needs.pending-p1.schema.json`
 * — a verbatim copy of the P1 lane's own committed `$defs`, not the pinned
 * contract). Mirrors `investigations.test.ts`'s own discipline: schema
 * validity plus negative controls that prove an invented vocabulary term is
 * actually rejected, not merely absent from the fixtures by omission.
 *
 * Deliberately does NOT run these fixtures through the real
 * `context_fabric_investigation_result.v1.schema.json` (the pinned
 * contract): that schema's `additionalProperties: false` would reject every
 * one of them for carrying `structure_needs`/`confirmed_structure`, which is
 * the whole reason this staging schema exists rather than reusing the real
 * one. The REST of each fixture (everything but the P1(+W1) fragment) is
 * still a real, pinned-schema-valid `investigations.ts` scenario at heart —
 * proven by the second describe block below.
 */
const ajv = new Ajv2020({
    allErrors: true,
    strictRequired: false,
    strictSchema: true,
    strictTypes: false,
});
addFormats(ajv);
const validateFragment = ajv.compile({
    $ref: "#/$defs/StructureAwareResultFragment",
    ...stagingSchema,
});

function fragmentOf(result: {
    readonly structure_needs?: unknown;
    readonly confirmed_structure?: unknown;
    readonly structure_offer_snapshot?: unknown;
    readonly window_clarification?: unknown;
}): Record<string, unknown> {
    const fragment: Record<string, unknown> = {};
    if (result.structure_needs !== undefined) fragment.structure_needs = result.structure_needs;
    if (result.confirmed_structure !== undefined)
        fragment.confirmed_structure = result.confirmed_structure;
    if (result.structure_offer_snapshot !== undefined)
        fragment.structure_offer_snapshot = result.structure_offer_snapshot;
    if (result.window_clarification !== undefined)
        fragment.window_clarification = result.window_clarification;
    return fragment;
}

describe("every structure-needs fixture's P1(+W1) fragment is staging-schema-valid", () => {
    for (const scenario of structureMockScenarios()) {
        it(`${scenario.id} validates`, () => {
            const valid = validateFragment(fragmentOf(scenario.result));
            expect(valid, ajv.errorsText(validateFragment.errors)).toBe(true);
        });
    }
});

describe("every structure-needs fixture is still a pinned-contract-valid base result", () => {
    for (const scenario of structureMockScenarios()) {
        it(`${scenario.id} is contract-valid once the P1(+W1) fragment is stripped`, () => {
            const {
                structure_needs,
                confirmed_structure,
                structure_offer_snapshot,
                window_clarification,
                ...rest
            } = scenario.result;
            void structure_needs;
            void confirmed_structure;
            void structure_offer_snapshot;
            void window_clarification;
            const validation = validateContract(
                "context_fabric_investigation_result.v1.schema.json",
                rest,
            );
            expect(validation.valid, validation.errors.join("; ")).toBe(true);
        });
    }
});

describe("negative controls: the staging schema actually rejects invented vocabulary", () => {
    it("rejects an invented StructureNeedKind", () => {
        const valid = validateFragment(
            fragmentOf({ structure_needs: { missing: ["subject_repository"] } }),
        );
        expect(valid).toBe(false);
    });

    it("rejects an invented StructureDisposition", () => {
        const valid = validateFragment(
            fragmentOf({
                confirmed_structure: [
                    {
                        member: "expected_kind",
                        applied_value: "pull_request",
                        source: "receipt",
                        provenance: "clarification_confirmed",
                        disposition: "silently_dropped",
                    },
                ],
            }),
        );
        expect(valid).toBe(false);
    });

    it("rejects a kind_options entry whose receipt_id is outside the kindr_ namespace", () => {
        const valid = validateFragment(
            fragmentOf({
                structure_needs: {
                    missing: ["expected_kind"],
                    kind_options: [
                        {
                            receipt_id: "ancr_wrong_namespace_0001",
                            option_id: "kind_pull_request",
                            label: "Pull request",
                            kind: "pull_request",
                            offer_source: "engine",
                        },
                    ],
                },
            }),
        );
        expect(valid).toBe(false);
    });

    it("rejects an additional property on ConfirmedStructureEntry", () => {
        const valid = validateFragment(
            fragmentOf({
                confirmed_structure: [
                    {
                        member: "expected_kind",
                        applied_value: "pull_request",
                        source: "receipt",
                        provenance: "clarification_confirmed",
                        disposition: "applied",
                        invented_field: "should not be allowed",
                    },
                ],
            }),
        );
        expect(valid).toBe(false);
    });
});
