import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import investigationResultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
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
