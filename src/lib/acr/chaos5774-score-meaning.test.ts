import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import investigationResultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import { validateContract } from "@/lib/acr/validate";

/**
 * CHAOS-5774 (two-step deploy, same class as the CHAOS-4413/CHAOS-4642
 * `completeness` test above): a ranked cohort answer now carries two new
 * optional fields (`cohort.score_meaning`, `cohort.judgment_mismatch`) and
 * the interpretation carries one more (`interpretation.requested_judgment_kind`).
 * All three are schema-OPTIONAL, but `additionalProperties: false` still
 * rejects them outright under the PRIOR (pre-pin) schema this repo carried
 * on origin/main -- verified directly below, the same executed-repro shape
 * the completeness test above already establishes.
 */
describe("investigation result contract — score meaning / judgment mismatch / requested judgment kind (CHAOS-5774)", () => {
    it("the canonical example (as pinned) validates, and carries cohort.score_meaning", () => {
        expect(canonicalResult).toHaveProperty("cohort.score_meaning", "attention");
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            canonicalResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("accepts cohort.judgment_mismatch alongside score_meaning", () => {
        const withMismatch = structuredClone(canonicalResult) as Record<string, unknown>;
        const cohort = withMismatch.cohort as Record<string, unknown>;
        cohort.judgment_mismatch = true;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withMismatch,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("REJECTS judgment_mismatch=true set without score_meaning", () => {
        const withMismatchOnly = structuredClone(canonicalResult) as Record<string, unknown>;
        const cohort = withMismatchOnly.cohort as Record<string, unknown>;
        delete cohort.score_meaning;
        cohort.judgment_mismatch = true;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withMismatchOnly,
        );
        expect(validation.valid).toBe(false);
    });

    it("accepts interpretation.requested_judgment_kind", () => {
        const withKind = structuredClone(canonicalResult) as Record<string, unknown>;
        const interpretation = withKind.interpretation as Record<string, unknown>;
        interpretation.requested_judgment_kind = "attention";
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withKind,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("REJECTS an out-of-vocabulary requested_judgment_kind", () => {
        const withBadKind = structuredClone(canonicalResult) as Record<string, unknown>;
        const interpretation = withBadKind.interpretation as Record<string, unknown>;
        interpretation.requested_judgment_kind = "productivity";
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withBadKind,
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * EXECUTED repro: the same canonical example, with all three new
     * fields set, run against a schema reproducing the PRIOR pin (this
     * field set stripped from `properties`/`required`, exactly what an
     * `additionalProperties: false` schema that has never heard of them
     * does) -- RED against that reproduction, GREEN against the real
     * pinned schema above.
     */
    it("EXECUTED repro: all three new fields would be rejected under the prior pin's own schema", () => {
        const withAllThree = structuredClone(canonicalResult) as Record<string, unknown>;
        const cohort = withAllThree.cohort as Record<string, unknown>;
        cohort.judgment_mismatch = false;
        const interpretation = withAllThree.interpretation as Record<string, unknown>;
        interpretation.requested_judgment_kind = "attention";

        const priorCommonSchema = structuredClone(commonSchema) as unknown as {
            $defs: {
                Cohort: { properties: Record<string, unknown> };
                InterpretedQuestion: { properties: Record<string, unknown> };
            };
        };
        delete priorCommonSchema.$defs.Cohort.properties.score_meaning;
        delete priorCommonSchema.$defs.Cohort.properties.judgment_mismatch;
        delete priorCommonSchema.$defs.InterpretedQuestion.properties.requested_judgment_kind;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorCommonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(withAllThree)).toBe(false);
        const properties = (validate.errors ?? []).map(
            (error): unknown => error.params?.additionalProperty,
        );
        expect(properties).toEqual(
            expect.arrayContaining([
                "score_meaning",
                "judgment_mismatch",
                "requested_judgment_kind",
            ]),
        );
    });
});
