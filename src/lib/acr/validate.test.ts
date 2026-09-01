import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import investigationResultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import renderShapesResult from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import { isDateTimeFormatted, validateContract } from "@/lib/acr/validate";

/**
 * codex review round 2: an earlier version of the conversation-turn
 * `created_at` guard used `Date.parse`, which is looser than the pinned
 * contract's own `format: "date-time"` (RFC 3339) — it accepts values the
 * schema rejects. `isDateTimeFormatted` runs the SAME ajv-formats check
 * `validateContract` uses everywhere else, so these cases are exactly what
 * distinguishes it from the loose check it replaced.
 */
describe("isDateTimeFormatted", () => {
    it("accepts what the client itself produces (new Date().toISOString())", () => {
        expect(isDateTimeFormatted(new Date("2026-01-01T00:00:00.000Z").toISOString())).toBe(true);
    });

    it("accepts an RFC 3339 date-time with a non-UTC numeric offset", () => {
        expect(isDateTimeFormatted("2026-01-01T00:00:00+02:00")).toBe(true);
    });

    it("rejects a date-only string — Date.parse would have accepted this", () => {
        expect(isDateTimeFormatted("2026-01-01")).toBe(false);
    });

    it("rejects a timestamp missing its UTC offset — Date.parse would have accepted this", () => {
        expect(isDateTimeFormatted("2026-01-01T00:00:00")).toBe(false);
    });

    it("rejects non-date-shaped garbage", () => {
        expect(isDateTimeFormatted("not-a-timestamp")).toBe(false);
        expect(isDateTimeFormatted("")).toBe(false);
    });
});

/**
 * CHAOS-4413/CHAOS-4642 (two-step deploy, CHAOS-4623): the pinned
 * `context_fabric_investigation_result.v1` schema's root carries
 * `additionalProperties: false` (CHAOS-4623's own finding). Before this pin
 * bump, that schema had never heard of `completeness` — the exact class of
 * failure CHAOS-4623 documents (acr #336's `render_shape`): an ACR response
 * carrying an additive field the pin does not know about is a hard
 * `acr_contract_violation`, not a tolerated unknown property. This is the
 * red/green evidence for the widening itself: the PRIOR pin (6ac060ea,
 * still what origin/main carries) rejects a `completeness`-bearing
 * response — reproduced directly below by validating against a schema
 * shaped exactly like that prior pin (no `AnswerCompleteness` $def, no
 * `completeness` property/requirement) — while THIS pin both accepts and
 * now REQUIRES it.
 */
describe("investigation result contract — completeness field (CHAOS-4413/CHAOS-4642)", () => {
    it("the canonical example (as pinned) validates, and carries completeness", () => {
        expect(canonicalResult).toHaveProperty("completeness");
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            canonicalResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("REJECTS a response missing completeness — it is required, not optional", () => {
        const withoutCompleteness = structuredClone(canonicalResult) as Record<string, unknown>;
        delete withoutCompleteness.completeness;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withoutCompleteness,
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (6ac060ea, still on
     * origin/main): the same document, run against a schema with
     * `completeness` stripped from `properties` and `required` — exactly
     * what an `additionalProperties: false` schema that has never heard of
     * the field does with it. RED against that reproduction, GREEN against
     * the real pinned schema above — this is the CHAOS-4623 failure mode,
     * executed.
     */
    it("EXECUTED repro: the field this pin adds would 502 under the prior pin's own schema", () => {
        const priorSchema = structuredClone(investigationResultSchema) as unknown as {
            properties: Record<string, unknown>;
            required: string[];
        };
        delete priorSchema.properties.completeness;
        priorSchema.required = priorSchema.required.filter((name) => name !== "completeness");

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(commonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(priorSchema);

        expect(validate(canonicalResult)).toBe(false);
    });
});

/**
 * CHAOS-4637/CHAOS-4683 (S6 consumer pin): `context_fabric_common.v1`'s
 * `ClaimedFact` $def carries `additionalProperties: false` (same class of
 * root cause as the CHAOS-4413/CHAOS-4642 block above, one level down in
 * the $ref closure). Before this pin, `ClaimedFact` had never heard of
 * `table` -- a response whose claimed facts declare it is exactly the
 * CHAOS-4623 failure mode: an additive field the pin does not know about is
 * a hard `acr_contract_violation`, not a tolerated unknown property. Unlike
 * `completeness`, `table` is schema-OPTIONAL (CHAOS-4656 doctrine) -- so
 * this pin only needs to ACCEPT it, never require it.
 */
describe("investigation result contract — claimed fact table declaration (CHAOS-4637/CHAOS-4683)", () => {
    it("a real acr-emitted response with `table`-bearing claims validates as-is", () => {
        const tabled = (
            renderShapesResult as { claimed_facts: Array<Record<string, unknown>> }
        ).claimed_facts.filter((claim) => "table" in claim);
        expect(tabled.length).toBeGreaterThan(0);
        /* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest types expect.any()'s return as `any` by design; these are matchers, not real values. */
        expect(tabled[0]?.table).toMatchObject({
            field: expect.any(String),
            shape: expect.any(String),
            key: expect.any(Array),
        });
        /* eslint-enable @typescript-eslint/no-unsafe-assignment */

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            renderShapesResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("still validates with every claimed fact's `table` stripped — the field is OPTIONAL, not required", () => {
        const withoutTable = structuredClone(renderShapesResult) as {
            claimed_facts: Array<Record<string, unknown>>;
        };
        for (const claim of withoutTable.claimed_facts) delete claim.table;

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withoutTable,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    /**
     * Reproduces the PRIOR pin's own validator (0a65f124, still on
     * origin/main before this PR): the same real acr-emitted document, run
     * against a `ClaimedFact` $def with `table` stripped from `properties`
     * (it was never in `required`, so no `required` edit is needed) --
     * exactly what an `additionalProperties: false` $def that has never
     * heard of the field does with it. RED against that reproduction, GREEN
     * against the real pinned schema above — this is the CHAOS-4623 failure
     * mode, executed, one level down the $ref closure from the
     * `completeness` case above.
     */
    it("EXECUTED repro: a `table`-bearing claim would 502 under the prior pin's own schema", () => {
        const priorCommonSchema = structuredClone(commonSchema) as unknown as {
            $defs: Record<string, { properties: Record<string, unknown> }>;
        };
        const claimedFactDef = priorCommonSchema.$defs.ClaimedFact;
        if (claimedFactDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no ClaimedFact $def");
        }
        delete claimedFactDef.properties.table;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorCommonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(renderShapesResult)).toBe(false);
        const tableRejections = (validate.errors ?? []).filter(
            (error) =>
                error.keyword === "additionalProperties" &&
                error.params?.additionalProperty === "table",
        );
        expect(tableRejections.length).toBeGreaterThan(0);
    });
});

/**
 * acr d261b265 (consumer pin, this PR): the closed `NarrowingBasis` enum
 * gains a fourth member, `overlap_aware_set_cover` -- the engine's
 * overlap-aware grouped-narrowing selection now names its own order
 * alongside the existing `canonical_id_lexical`/`largest_group_round_robin`/
 * `attention_rank`. `NarrowingBasis` has no top-level document home in
 * either example fixture (`answer_plan` is optional and absent from both),
 * so these tests compile a targeted `$ref` to `AnswerPlanBudget` directly
 * -- the same technique `validateContract` uses internally, scoped to the
 * one $def this pin touches.
 */
describe("narrowing basis vocabulary — overlap_aware_set_cover (acr d261b265 consumer pin)", () => {
    function budgetWithBasis(basis: string): Record<string, unknown> {
        return {
            max_items: 10,
            max_serialized_bytes: 10_000,
            max_members: 5,
            synthesis_headroom: 2,
            narrowing_basis: basis,
        };
    }

    function compileAnswerPlanBudget(schema: unknown) {
        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(schema as object, "context_fabric_common.v1.schema.json");
        return ajv.compile({
            $ref: "context_fabric_common.v1.schema.json#/$defs/AnswerPlanBudget",
        });
    }

    it("every pre-existing basis still validates — old-shape tolerance", () => {
        const validate = compileAnswerPlanBudget(commonSchema);
        for (const basis of [
            "canonical_id_lexical",
            "largest_group_round_robin",
            "attention_rank",
        ]) {
            expect(validate(budgetWithBasis(basis))).toBe(true);
        }
    });

    it("the new value validates against the pinned schema — new-shape tolerance", () => {
        const validate = compileAnswerPlanBudget(commonSchema);
        expect(validate(budgetWithBasis("overlap_aware_set_cover"))).toBe(true);
    });

    /**
     * Reproduces the PRIOR pin's own validator (a6414816, still on
     * origin/main before this PR): the same document, run against a
     * `NarrowingBasis` $def with `overlap_aware_set_cover` stripped from its
     * `enum` — exactly the `acr_contract_violation` 502 an acr response
     * carrying the new value hits under the unbumped pin. RED against that
     * reproduction, GREEN against the real pinned schema above.
     */
    it("EXECUTED repro: the new value would 502 under the prior pin's own schema", () => {
        const priorSchema = structuredClone(commonSchema) as unknown as {
            $defs: Record<string, { enum: string[] }>;
        };
        const narrowingBasisDef = priorSchema.$defs.NarrowingBasis;
        if (narrowingBasisDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no NarrowingBasis $def");
        }
        narrowingBasisDef.enum = narrowingBasisDef.enum.filter(
            (value) => value !== "overlap_aware_set_cover",
        );

        const validate = compileAnswerPlanBudget(priorSchema);
        expect(validate(budgetWithBasis("overlap_aware_set_cover"))).toBe(false);
        const enumRejections = (validate.errors ?? []).filter((error) => error.keyword === "enum");
        expect(enumRejections.length).toBeGreaterThan(0);
    });
});
