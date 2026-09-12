import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import investigationResultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import renderShapesResult from "@/contracts/examples/context_fabric_investigation_result_render_shapes.v1.json";
import unsupportedResult from "@/contracts/examples/context_fabric_investigation_result_unsupported.v1.json";
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
 * acr dbde584b (consumer pin, this PR): `ClaimedFactTable` gains a third
 * declared column role, `observations` -- a per-row categorical column (a
 * severity label, an as-of date, a boolean flag) that used to have nowhere
 * to go but `measures`, the same slot a numeric identity column could hide
 * in undetected. The fixture's own health claim (`daily_health`) now
 * declares `measures: ["compounding_risk"]` and `observations: ["severity"]`,
 * so the real acr-emitted document already proves the new-shape half; these
 * tests add the old-shape tolerance and the executed prior-pin repro, the
 * same three-case shape the `table` declaration block above already
 * establishes for `key`/`measures`.
 */
describe("investigation result contract — declared table observations (acr dbde584b consumer pin)", () => {
    it("a real acr-emitted response with an `observations`-bearing table validates as-is", () => {
        const observed = (
            renderShapesResult as { claimed_facts: Array<Record<string, unknown>> }
        ).claimed_facts.filter(
            (claim) =>
                "table" in claim &&
                Array.isArray((claim.table as { observations?: unknown[] }).observations) &&
                ((claim.table as { observations: unknown[] }).observations.length ?? 0) > 0,
        );
        expect(observed.length).toBeGreaterThan(0);
        expect(observed[0]?.table).toMatchObject({ observations: ["severity"] });

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            renderShapesResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("still validates with every claimed fact's `table.observations` stripped — the field is OPTIONAL, not required", () => {
        const withoutObservations = structuredClone(renderShapesResult) as {
            claimed_facts: Array<{ table?: Record<string, unknown> }>;
        };
        for (const claim of withoutObservations.claimed_facts) {
            if (claim.table !== undefined) delete claim.table.observations;
        }

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withoutObservations,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    /**
     * Reproduces the PRIOR pin's own validator (d261b265, still on
     * origin/main before this PR): the same real acr-emitted document, run
     * against a `ClaimedFactTable` $def with `observations` stripped from
     * its `properties` (it was never in `required`, so no `required` edit
     * is needed) -- exactly what an `additionalProperties: false` $def that
     * has never heard of the field does with it. RED against that
     * reproduction, GREEN against the real pinned schema above.
     */
    it("EXECUTED repro: an `observations`-bearing table would 502 under the prior pin's own schema", () => {
        const priorCommonSchema = structuredClone(commonSchema) as unknown as {
            $defs: Record<string, { properties: Record<string, unknown> }>;
        };
        const claimedFactTableDef = priorCommonSchema.$defs.ClaimedFactTable;
        if (claimedFactTableDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no ClaimedFactTable $def");
        }
        delete claimedFactTableDef.properties.observations;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorCommonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(renderShapesResult)).toBe(false);
        const observationsRejections = (validate.errors ?? []).filter(
            (error) =>
                error.keyword === "additionalProperties" &&
                error.params?.additionalProperty === "observations",
        );
        expect(observationsRejections.length).toBeGreaterThan(0);
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
/**
 * acr 9b2069de (consumer pin, this PR — CHAOS-4682, §5.1 P2 dual-read
 * cutover): `ClaimedFact` gains an additive, optional pair —
 * `time_series_table` ($ref the SAME `ClaimedFactTable` $def `table`
 * already uses) and `time_series_rows` (array of the SAME `ClaimedFactRow`
 * $def `rows` already uses, `maxItems: 64`) — no new $defs. The pair rides
 * ALONGSIDE the legacy `table`/`rows`, which keep their current meaning
 * unconditionally; this pin only teaches the schema the new pair exists.
 * The fixture's own `claim_workload_ask_dev_backlog` claim carries BOTH
 * pairs at once (a legacy `team_breakdown` table AND a genuine
 * `daily_workload` time series), so the real acr-emitted document proves
 * the dual-table (BOTH-SHAPES) case round-trips; these tests add the
 * single-pair tolerance and the executed prior-pin repro, the same
 * three-case shape the `table`/`observations` blocks above establish.
 */
describe("investigation result contract — additive time_series pair (acr 9b2069de consumer pin, CHAOS-4682)", () => {
    it("a real acr-emitted response with a dual-table (BOTH-SHAPES) claim validates as-is", () => {
        const dualTable = (
            renderShapesResult as { claimed_facts: Array<Record<string, unknown>> }
        ).claimed_facts.filter((claim) => "time_series_rows" in claim && "table" in claim);
        expect(dualTable.length).toBeGreaterThan(0);
        expect(dualTable[0]).toMatchObject({
            // The legacy pair: unaffected, still present.
            /* eslint-disable @typescript-eslint/no-unsafe-assignment -- vitest matchers */
            table: expect.any(Object),
            rows: expect.any(Array),
            // The additive pair: present alongside it.
            time_series_table: expect.any(Object),
            time_series_rows: expect.any(Array),
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */
        });

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            renderShapesResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("a single-table claim (the new pair entirely absent) still validates — old-shape tolerance", () => {
        const withoutNewPair = structuredClone(renderShapesResult) as {
            claimed_facts: Array<Record<string, unknown>>;
        };
        for (const claim of withoutNewPair.claimed_facts) {
            delete claim.time_series_table;
            delete claim.time_series_rows;
        }

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withoutNewPair,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("an unrecognized field on a claimed fact still rejects — additionalProperties stays closed", () => {
        const tampered = structuredClone(renderShapesResult) as {
            claimed_facts: Array<Record<string, unknown>>;
        };
        tampered.claimed_facts[0]!.not_a_real_field = "anything";

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            tampered,
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (dbde584b, still on
     * origin/main before this PR): the same real acr-emitted document, run
     * against a `ClaimedFact` $def with `time_series_table`/
     * `time_series_rows` stripped from its `properties` (neither was ever in
     * `required`, so no `required` edit is needed) -- exactly what an
     * `additionalProperties: false` $def that has never heard of either
     * field does with them. RED against that reproduction, GREEN against the
     * real pinned schema above.
     */
    it("EXECUTED repro: the dual-table claim would 502 under the prior pin's own schema", () => {
        const priorCommonSchema = structuredClone(commonSchema) as unknown as {
            $defs: Record<string, { properties: Record<string, unknown> }>;
        };
        const claimedFactDef = priorCommonSchema.$defs.ClaimedFact;
        if (claimedFactDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no ClaimedFact $def");
        }
        delete claimedFactDef.properties.time_series_table;
        delete claimedFactDef.properties.time_series_rows;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorCommonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(renderShapesResult)).toBe(false);
        const rejections = (validate.errors ?? []).filter(
            (error) =>
                error.keyword === "additionalProperties" &&
                (error.params?.additionalProperty === "time_series_table" ||
                    error.params?.additionalProperty === "time_series_rows"),
        );
        expect(rejections.length).toBeGreaterThan(0);
    });
});

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

/**
 * CHAOS-4836 (acr 9e2bbede consumer pin, containing #382 CHAOS-4825 and #383
 * CHAOS-4831): `CoverageDetail.code`'s closed enum gains a 12th value,
 * `reuse_auxiliary_refs_stripped`. Answer reuse never hit on the live org
 * because its evidence-containment recheck refused outright on ANY missing
 * auxiliary (non-cited) ref (CHAOS-4831); the fix strips the unverifiable
 * auxiliary refs and serves a narrowed answer instead, disclosing the
 * narrowing with this code plus a required `count`
 * (`internal/contextfabric/answer_reuse_degrade.go:603-611`,
 * `internal/contracts/v1/context_fabric_coverage_detail.go:282` --
 * `requireCount: true` for this code). Without this bump a degraded reuse
 * answer fails CLOSED here with `acr_contract_violation` and reads as a rig
 * failure, not a pin gap -- exactly the failure mode this ticket exists to
 * close.
 */
describe("coverage detail code — reuse_auxiliary_refs_stripped (acr 9e2bbede consumer pin, CHAOS-4836/CHAOS-4831)", () => {
    function reuseDegradedResult(): Record<string, unknown> {
        const result = structuredClone(canonicalResult) as {
            coverage: { partial: boolean; degraded_reasons: string[]; details?: unknown[] };
            evidence_ref_ids: string[];
        };
        result.coverage.partial = true;
        result.coverage.degraded_reasons = [
            "Some supporting evidence was no longer visible and was removed.",
        ];
        result.coverage.details = [
            {
                detail_id: "cov-reuse-01",
                source: "context-fabric:answer-reuse",
                code: "reuse_auxiliary_refs_stripped",
                degrading: true,
                count: 1,
                label: "1 supporting item is no longer visible to you and were removed",
            },
        ];
        return {
            ...result,
            // CHAOS-4690: a fresh write's evidence_ref_labels key set equals
            // the result's own evidence-ref closure exactly.
            evidence_ref_labels: Object.fromEntries(
                result.evidence_ref_ids.map((ref) => [ref, ref]),
            ),
        };
    }

    it("a reuse-degraded response validates as-is", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            reuseDegradedResult(),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("RED CONTROL: an unrecognized coverage detail code still rejects — the enum stays closed", () => {
        const tampered = reuseDegradedResult() as {
            coverage: { details: Array<Record<string, unknown>> };
        };
        tampered.coverage.details[0]!.code = "reuse_bogus_code";

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            tampered,
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (9b2069de, still on
     * origin/main before this PR): the same reuse-degraded document, run
     * against a `CoverageDetail` $def with `reuse_auxiliary_refs_stripped`
     * stripped from its `code` enum -- exactly the `acr_contract_violation`
     * a degraded reuse answer hits under the unbumped pin, which is what
     * made CHAOS-4836 read as a rig failure rather than a pin gap. RED
     * against that reproduction, GREEN against the real pinned schema
     * above.
     */
    it("EXECUTED repro: a reuse-degraded answer would 502 under the prior pin's own schema", () => {
        const priorSchema = structuredClone(commonSchema) as unknown as {
            $defs: { CoverageDetail: { properties: { code: { enum: string[] } } } };
        };
        const codeDef = priorSchema.$defs.CoverageDetail?.properties.code;
        if (codeDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no CoverageDetail.code property");
        }
        codeDef.enum = codeDef.enum.filter((value) => value !== "reuse_auxiliary_refs_stripped");

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(reuseDegradedResult())).toBe(false);
        const enumRejections = (validate.errors ?? []).filter((error) => error.keyword === "enum");
        expect(enumRejections.length).toBeGreaterThan(0);
    });
});

/**
 * CHAOS-4836 / CHAOS-4825 (rode the same acr 9e2bbede pin): `$defs.SourceObservation`
 * gained optional `label`/`state_label`, but that NAMED $def has zero $refs
 * anywhere in acr and validates nothing on the wire (the ticket's own
 * finding -- a definition nobody validates through went stale for a whole
 * release cycle without any test noticing). What actually reaches ask-dev is
 * the INLINE copy of the same shape at `Coverage.properties.sources.items`,
 * which already carried `label`/`state_label` before this bump and is
 * unchanged by it. This test exercises that inline, wire-facing copy so the
 * accept path for a labelled coverage source has coverage of its own,
 * exactly per the suggestion on CHAOS-4836's comment thread.
 */
describe("coverage source label/state_label (inline SourceObservation shape, unchanged by acr 9e2bbede)", () => {
    it("a coverage source carrying label and state_label validates", () => {
        const labelled = structuredClone(canonicalResult) as {
            coverage: { sources: Array<Record<string, unknown>> };
        };
        labelled.coverage.sources[0]!.label = "Delivery status";
        labelled.coverage.sources[0]!.state_label = "Available";

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            labelled,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });
});

/**
 * acr 7c6eda59 consumer pin (#422, S7c "say what became of each requirement,
 * and narrow instead of refusing" -- outcome-driven assembly):
 * `AnswerCompleteness` gains an optional `outcomes[]` array of the new closed
 * `$defs.PlanRequirementOutcomeRow` (required `stage`/`outcome`/`impact`/
 * `cause_observed`/`served`/`declared`) and a `state` field that moves from
 * ABSENT to REQUIRED -- a closed 4-value vocabulary
 * (`not_derived`/`complete`/`partial`/`degraded`) derived from the outcome
 * set, never authored independently. Unlike every prior bump in this file,
 * the breaking half here is `state` becoming required, not a new value
 * joining an existing enum -- so the old-shape/new-shape pair below is
 * "missing state now rejects" / "state present validates", the mirror image
 * of the usual "old shape still tolerated" case.
 */
describe("investigation result contract — outcome-driven completeness (acr 7c6eda59 consumer pin, #422/S7c)", () => {
    function outcomeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            stage: "reuse",
            outcome: "narrowed",
            impact: "depth",
            cause_overrun: "items",
            cause_observed: true,
            served: 13,
            declared: 18,
            ...overrides,
        };
    }

    function resultWithOutcomes(outcomes: unknown[], state = "partial"): Record<string, unknown> {
        const result = structuredClone(canonicalResult) as {
            completeness: Record<string, unknown>;
        };
        result.completeness.state = state;
        result.completeness.outcomes = outcomes;
        return result;
    }

    it("the pinned canonical example (as regenerated) carries a required state and validates", () => {
        expect(canonicalResult).toHaveProperty("completeness.state", "not_derived");
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            canonicalResult,
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("REJECTS a response missing completeness.state — it is required as of this pin", () => {
        const withoutState = structuredClone(canonicalResult) as {
            completeness: Record<string, unknown>;
        };
        delete withoutState.completeness.state;

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            withoutState,
        );
        expect(validation.valid).toBe(false);
    });

    it("an outcome set including the new `reuse` stage validates as-is", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow({ stage: "reuse" })]),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("every outcome stage validates — planning, assembled_result, projection, reuse", () => {
        for (const stage of ["planning", "assembled_result", "projection", "reuse"]) {
            const validation = validateContract(
                "context_fabric_investigation_result.v1.schema.json",
                resultWithOutcomes([outcomeRow({ stage })]),
            );
            expect(validation.errors).toEqual([]);
            expect(validation.valid).toBe(true);
        }
    });

    it("an empty outcome set with state not_derived validates — the vacuous-complete trap closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([], "not_derived"),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("REJECTS an unrecognized `stage` — the outcome stage vocabulary stays closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow({ stage: "not_a_real_stage" })]),
        );
        expect(validation.valid).toBe(false);
    });

    it("REJECTS an unrecognized `outcome` — the requirement-outcome vocabulary stays closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow({ outcome: "not_a_real_outcome" })]),
        );
        expect(validation.valid).toBe(false);
    });

    it("REJECTS an unrecognized `impact` — the impact vocabulary stays closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow({ impact: "not_a_real_impact" })]),
        );
        expect(validation.valid).toBe(false);
    });

    it("REJECTS an unrecognized `cause_overrun` — the overrun-cause vocabulary stays closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow({ cause_overrun: "not_a_real_cause" })]),
        );
        expect(validation.valid).toBe(false);
    });

    it("REJECTS an unrecognized `state` — the completeness-state vocabulary stays closed", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([outcomeRow()], "not_a_real_state"),
        );
        expect(validation.valid).toBe(false);
    });

    it("REJECTS an outcome row missing a required field (declared) — additionalProperties stays closed on the row shape too", () => {
        const incomplete = outcomeRow();
        delete incomplete.declared;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            resultWithOutcomes([incomplete]),
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (9e2bbede, still on
     * origin/main before this PR): the same regenerated canonical example
     * (which now carries `completeness.state`), run against an
     * `AnswerCompleteness` $def with `state` stripped from `properties` and
     * `required` -- exactly what an `additionalProperties: false` schema
     * that has never heard of the field does with it. RED against that
     * reproduction, GREEN against the real pinned schema above.
     */
    it("EXECUTED repro: a state-bearing completeness block would 502 under the prior pin's own schema", () => {
        const priorCommonSchema = structuredClone(commonSchema) as unknown as {
            $defs: Record<string, { properties: Record<string, unknown>; required: string[] }>;
        };
        const answerCompletenessDef = priorCommonSchema.$defs.AnswerCompleteness;
        if (answerCompletenessDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no AnswerCompleteness $def");
        }
        delete answerCompletenessDef.properties.state;
        delete answerCompletenessDef.properties.outcomes;
        answerCompletenessDef.required = answerCompletenessDef.required.filter(
            (name) => name !== "state",
        );

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorCommonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(canonicalResult)).toBe(false);
        const stateRejections = (validate.errors ?? []).filter(
            (error) =>
                error.keyword === "additionalProperties" &&
                error.params?.additionalProperty === "state",
        );
        expect(stateRejections.length).toBeGreaterThan(0);
    });
});

/**
 * The read-population pin (acr 084ab9c4): `CoverageDetail.code`'s closed enum
 * gains `read_population_unverified`.
 *
 * A read requirement whose completion scope is distributive — `each_operand`,
 * `each_member`, `each_group` — over a population NOTHING CAN ENUMERATE now
 * discloses that with its own code, because every neighbour would have been a
 * plausible lie: `population_truncated` says a population WAS enumerated and is
 * a known floor, and `fact_pruned` is declared never-degrading while this arm
 * IS degrading — the reader asked for a cell and gets none of it.
 *
 * Without this bump such an answer fails CLOSED here with
 * `acr_contract_violation` and reads as a rig failure rather than a pin gap —
 * the same failure mode the reuse-strip bump above exists to close, and the
 * reason a new acr code and its consumer pin travel together.
 */
describe("coverage detail code — read_population_unverified (acr 084ab9c4 consumer pin)", () => {
    function unverifiedPopulationResult(): Record<string, unknown> {
        const result = structuredClone(canonicalResult) as {
            coverage: { partial: boolean; degraded_reasons: string[]; details?: unknown[] };
            evidence_ref_ids: string[];
        };
        result.coverage.partial = true;
        result.coverage.degraded_reasons = [
            "Part of what you asked about could not be identified, so it was not read.",
        ];
        // NO `count`: this code carries no required count, and that is the
        // point of it — nothing enumerated the population, so there is no
        // number to report. A fixture inventing one would assert a shape acr
        // does not produce.
        result.coverage.details = [
            {
                detail_id: "cov-readpop-01",
                source: "context-fabric:read-population",
                code: "read_population_unverified",
                degrading: true,
                label: "Some of what you asked about could not be identified",
            },
        ];
        return {
            ...result,
            evidence_ref_labels: Object.fromEntries(
                result.evidence_ref_ids.map((ref) => [ref, ref]),
            ),
        };
    }

    it("an unverified-population response validates as-is", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            unverifiedPopulationResult(),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("RED CONTROL: an unrecognized coverage detail code still rejects — the enum stays closed", () => {
        const tampered = unverifiedPopulationResult() as {
            coverage: { details: Array<Record<string, unknown>> };
        };
        tampered.coverage.details[0]!.code = "read_population_bogus_code";

        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            tampered,
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (c6aaa727, on origin/main
     * before this PR): the same document against a `CoverageDetail` $def with
     * `read_population_unverified` stripped from its `code` enum — exactly the
     * `acr_contract_violation` this answer hits under the unbumped pin. RED
     * against that reproduction, GREEN against the real pinned schema above.
     * Without this arm the test above proves only that the schema accepts the
     * document, never that the BUMP is what made it acceptable.
     */
    it("EXECUTED repro: an unverified-population answer would 502 under the prior pin's own schema", () => {
        const priorSchema = structuredClone(commonSchema) as unknown as {
            $defs: { CoverageDetail: { properties: { code: { enum: string[] } } } };
        };
        const codeDef = priorSchema.$defs.CoverageDetail?.properties.code;
        if (codeDef === undefined) {
            throw new Error("context_fabric_common.v1 schema has no CoverageDetail.code property");
        }
        codeDef.enum = codeDef.enum.filter((value) => value !== "read_population_unverified");

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(investigationResultSchema);

        expect(validate(unverifiedPopulationResult())).toBe(false);
        const enumRejections = (validate.errors ?? []).filter((error) => error.keyword === "enum");
        expect(enumRejections.length).toBeGreaterThan(0);
    });
});

/**
 * The fact-scope-census pin (acr #490, fca2ddad): `context_fabric_common.v1`
 * gains the `FactScopeCensusRecord` $def and
 * `context_fabric_investigation_result.v1` gains the optional
 * `fact_scope_census` array (<=21 items) built from it — codex review round
 * 1 (CHAOS-5552 r1): no case in this suite exercised the new field at all,
 * so removing the property/ref, breaking a census record's shape, or
 * changing the 21-item boundary would leave this suite green.
 *
 * The fixture record below is not invented: it is the shape a real
 * `acr-api` @ b8df5dde served for "Which teams are struggling, and why?"
 * against the static k3s trial-data store during this PR's own
 * EXECUTE-THE-CLAIM proof (see the commit body's TEST-EVIDENCE).
 */
describe("investigation result contract — fact scope census (acr #490 consumer pin)", () => {
    function censusRecord(): Record<string, unknown> {
        return {
            requirement_kind: "blockers",
            origin_kind: "team",
            policy: "team_primary_attribution_work_item_blockers_v1",
            basis: "attributed_primary_team",
            axis: "current",
            outcome: "expanded",
            target_limit: 200,
            population_measured: true,
            authorized_population_count: 6,
            admitted_count: 6,
            truncated: false,
        };
    }

    function censusResult(records: readonly Record<string, unknown>[]): Record<string, unknown> {
        return { ...structuredClone(canonicalResult), fact_scope_census: records };
    }

    it("a real acr-emitted response carrying fact_scope_census validates as-is", () => {
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([censusRecord()]),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("a census record whose population was never measured serializes null, not 0 — the two stay distinct documents", () => {
        const unmeasured = censusRecord();
        unmeasured.population_measured = false;
        unmeasured.authorized_population_count = null;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([unmeasured]),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("RED CONTROL: a census record with an unrecognized property still rejects — additionalProperties: false", () => {
        const tampered = censusRecord();
        tampered.unexpected_field = "should not be accepted";
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([tampered]),
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Read from the schema's own `maxItems`, not a hand-typed `21` — a bound
     * this test hard-coded would keep passing after the schema's own bound
     * moved, which is exactly the "silently stale under a moved pin" class
     * D-d's own bump-testing convention exists to close.
     */
    function factScopeCensusMaxItems(): number {
        const schema = investigationResultSchema as unknown as {
            properties: { fact_scope_census: { maxItems: number } };
        };
        return schema.properties.fact_scope_census.maxItems;
    }

    it("accepts exactly maxItems census records", () => {
        const atLimit = Array.from({ length: factScopeCensusMaxItems() }, () => censusRecord());
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult(atLimit),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("RED CONTROL: one more than maxItems census records breaches the boundary", () => {
        const overLimit = Array.from({ length: factScopeCensusMaxItems() + 1 }, () =>
            censusRecord(),
        );
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult(overLimit),
        );
        expect(validation.valid).toBe(false);
    });

    /**
     * Reproduces the PRIOR pin's own validator (0945a53d, on origin/main
     * before this PR): the same real acr-emitted document, run against a
     * schema with `fact_scope_census` stripped from `properties` — exactly
     * what an `additionalProperties: false` schema that has never heard of
     * the field does with it. RED against that reproduction, GREEN against
     * the real pinned schema above — without this arm the tests above prove
     * only that the schema accepts the document, never that the BUMP is
     * what made it acceptable.
     */
    it("EXECUTED repro: a fact_scope_census-bearing answer would 502 under the prior pin's own schema", () => {
        const priorSchema = structuredClone(investigationResultSchema) as unknown as {
            properties: Record<string, unknown>;
        };
        delete priorSchema.properties.fact_scope_census;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(commonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(priorSchema);

        expect(validate(censusResult([censusRecord()]))).toBe(false);
        const additionalPropertyRejections = (validate.errors ?? []).filter(
            (error) => error.keyword === "additionalProperties",
        );
        expect(additionalPropertyRejections.length).toBeGreaterThan(0);
    });

    /**
     * codex review round 3 (CHAOS-5552 r3): the tests above only ever submit
     * a FULLY well-formed record (or one with an unrecognized property, or
     * too many of them) -- none of them exercise `required`, `minimum` or
     * `maxLength` on FactScopeCensusRecord's own fields, so a mutation that
     * drops a required property, widens a numeric floor, or lengthens a
     * string bound would leave every test above green. Read from the
     * SCHEMA's own `required` array -- never a hand-typed field list -- so
     * this stays correct if the record ever gains or loses a required
     * field.
     */
    function factScopeCensusRequiredFields(): readonly string[] {
        const schema = commonSchema as unknown as {
            $defs: { FactScopeCensusRecord: { required: readonly string[] } };
        };
        return schema.$defs.FactScopeCensusRecord.required;
    }

    it.each(factScopeCensusRequiredFields())(
        "RED CONTROL: a census record missing required field %s rejects",
        (field) => {
            const missingField = censusRecord();
            delete missingField[field];
            const validation = validateContract(
                "context_fabric_investigation_result.v1.schema.json",
                censusResult([missingField]),
            );
            expect(validation.valid).toBe(false);
        },
    );

    it("RED CONTROL: a negative admitted_count breaches the schema's minimum: 0", () => {
        const negative = censusRecord();
        negative.admitted_count = -1;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([negative]),
        );
        expect(validation.valid).toBe(false);
    });

    it("RED CONTROL: a negative target_limit breaches the schema's minimum: 0", () => {
        const negative = censusRecord();
        negative.target_limit = -1;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([negative]),
        );
        expect(validation.valid).toBe(false);
    });

    it("RED CONTROL: requirement_kind past the schema's maxLength: 128 rejects", () => {
        const tooLong = censusRecord();
        tooLong.requirement_kind = "x".repeat(129);
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([tooLong]),
        );
        expect(validation.valid).toBe(false);
    });

    it("RED CONTROL: a string where population_measured must be a boolean rejects", () => {
        const wrongType = censusRecord();
        wrongType.population_measured = "true";
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([wrongType]),
        );
        expect(validation.valid).toBe(false);
    });
});

/**
 * The fact-scope-census MEASUREMENT INVARIANT pin (acr #501, d949d18c):
 * `FactScopeCensusRecord` gains an `if`/`then`/`else` enforcing the one
 * distinction `authorized_population_count`'s own nullability exists to
 * carry — codex review, ask-dev PR #54 r1: the prior pin declared the field
 * NULLABLE with that intent in prose ("null means the census did not
 * complete, 0 means it did and the caller-visible population is genuinely
 * none") but never enforced it, so a schema-only consumer — this one,
 * before this bump — accepted a document asserting and denying that
 * distinction in the same record.
 *
 * The two contradictory shapes below are not invented: they are the exact
 * two documents the invariant exists to tell apart, built from the SAME
 * real-acr-emitted fixture (`censusRecord()`) the describe block above
 * uses, so a rejection here is provably about the measurement/count
 * agreement and nothing else about the record's shape.
 */
describe("investigation result contract — fact scope census measurement invariant (acr #501 consumer pin)", () => {
    function censusRecord(): Record<string, unknown> {
        return {
            requirement_kind: "blockers",
            origin_kind: "team",
            policy: "team_primary_attribution_work_item_blockers_v1",
            basis: "attributed_primary_team",
            axis: "current",
            outcome: "expanded",
            target_limit: 200,
            population_measured: true,
            authorized_population_count: 6,
            admitted_count: 6,
            truncated: false,
        };
    }

    function censusResult(records: readonly Record<string, unknown>[]): Record<string, unknown> {
        return { ...structuredClone(canonicalResult), fact_scope_census: records };
    }

    it("RED CONTROL: population_measured=false beside a non-null count contradicts itself and now rejects", () => {
        const contradiction = censusRecord();
        contradiction.population_measured = false;
        contradiction.authorized_population_count = 0;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([contradiction]),
        );
        expect(validation.valid).toBe(false);
    });

    it("RED CONTROL: population_measured=true beside a null count contradicts itself and now rejects", () => {
        const contradiction = censusRecord();
        contradiction.population_measured = true;
        contradiction.authorized_population_count = null;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([contradiction]),
        );
        expect(validation.valid).toBe(false);
    });

    it("a measured zero (true, 0) is the OTHER legal shape and still validates — the invariant is an agreement rule, not a ban on either value", () => {
        const measuredZero = censusRecord();
        measuredZero.population_measured = true;
        measuredZero.authorized_population_count = 0;
        const validation = validateContract(
            "context_fabric_investigation_result.v1.schema.json",
            censusResult([measuredZero]),
        );
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    /**
     * Reproduces the PRIOR pin's own validator (b8df5dde, on origin/main
     * before this PR): the SAME two contradictory documents, run against a
     * copy of the schema with the if/then/else stripped back out — exactly
     * what the field's nullable-but-unenforced declaration did with them.
     * RED against that reproduction is expected to be GREEN (accepted) —
     * without this arm the two RED CONTROLs above prove only that the new
     * schema rejects the documents, never that the BUMP is what made it
     * reject them.
     */
    it("EXECUTED repro: both contradictory documents validated clean under the prior pin's own schema", () => {
        const priorSchema = structuredClone(commonSchema) as unknown as {
            $defs: { FactScopeCensusRecord: Record<string, unknown> };
        };
        delete priorSchema.$defs.FactScopeCensusRecord.if;
        delete priorSchema.$defs.FactScopeCensusRecord.then;
        delete priorSchema.$defs.FactScopeCensusRecord.else;

        const priorResultSchema = structuredClone(investigationResultSchema);
        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(priorSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(priorResultSchema);

        const measuredFalseWithCount = censusRecord();
        measuredFalseWithCount.population_measured = false;
        measuredFalseWithCount.authorized_population_count = 0;
        expect(validate(censusResult([measuredFalseWithCount]))).toBe(true);

        const measuredTrueWithNull = censusRecord();
        measuredTrueWithNull.population_measured = true;
        measuredTrueWithNull.authorized_population_count = null;
        expect(validate(censusResult([measuredTrueWithNull]))).toBe(true);
    });
});

/**
 * acr #504 (85f037db): `deterministic_answer` is required non-empty iff the
 * result is SUPPORTED -- `status` is `complete`/`partial`, OR the result
 * carries at least one claimed fact AND at least one evidence ref. An
 * UNSUPPORTED terminal result may carry `""`; its disclosure lives in
 * `limitations`, `coverage`, and `completeness`. The key itself stays
 * required.
 *
 * Each rejection below is paired with the SAME document carrying a non-empty
 * answer, which validates: the answer sentence is the only reason the
 * document fails, so no RED CONTROL passes on some unrelated rule.
 */
describe("investigation result contract — answer sentence required iff supported (acr #504 consumer pin)", () => {
    const RESULT = "context_fabric_investigation_result.v1.schema.json";
    const EMPTY_ANSWER_ERROR = "/deterministic_answer must NOT have fewer than 1 characters";
    // ajv (allErrors) reports the failed `then` branch beside the keyword it
    // failed on; both entries name the one conditional this pin added.
    const EMPTY_ANSWER_ERRORS = [EMPTY_ANSWER_ERROR, ' must match "then" schema'];

    function unsupported(): Record<string, unknown> {
        const clone: Record<string, unknown> = structuredClone(unsupportedResult);
        return clone;
    }

    it("acr's own unsupported example (as pinned) validates: degraded, no facts, no evidence, empty answer, a disclosed limitation", () => {
        expect(unsupportedResult.status).toBe("degraded");
        expect(unsupportedResult.claimed_facts).toEqual([]);
        expect(unsupportedResult.evidence_ref_ids).toEqual([]);
        expect(unsupportedResult.deterministic_answer).toBe("");
        expect(unsupportedResult.limitations.length).toBeGreaterThan(0);
        const validation = validateContract(RESULT, unsupportedResult);
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it("RED CONTROL (support arm): the canonical complete result with an empty answer rejects on the answer alone", () => {
        const emptied = structuredClone(canonicalResult) as unknown as Record<string, unknown>;
        emptied.deterministic_answer = "";
        const validation = validateContract(RESULT, emptied);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toEqual(EMPTY_ANSWER_ERRORS);
    });

    it("RED CONTROL (status arm): a partial result with no facts and an empty answer rejects on the answer alone; with an answer it validates", () => {
        const partial = unsupported();
        partial.status = "partial";
        partial.direct_judgment = "Ask Dev is partly readable.";
        const validation = validateContract(RESULT, partial);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toEqual(EMPTY_ANSWER_ERRORS);

        partial.deterministic_answer = "Ask Dev is partly readable.";
        expect(validateContract(RESULT, partial).errors).toEqual([]);
    });

    it("RED CONTROL (facts AND evidence arm): a degraded result that carries facts and evidence is supported, so an empty answer rejects; with an answer it validates", () => {
        const supportedDegraded = unsupported();
        supportedDegraded.claimed_facts = structuredClone(canonicalResult.claimed_facts);
        supportedDegraded.evidence_ref_ids = structuredClone(canonicalResult.evidence_ref_ids);
        const validation = validateContract(RESULT, supportedDegraded);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toEqual(EMPTY_ANSWER_ERRORS);

        supportedDegraded.deterministic_answer = "Ask Dev is degraded.";
        expect(validateContract(RESULT, supportedDegraded).errors).toEqual([]);
    });

    it("the support arm is a conjunction: facts without evidence, or evidence without facts, stays unsupported and may carry an empty answer", () => {
        const factsOnly = unsupported();
        factsOnly.claimed_facts = structuredClone(canonicalResult.claimed_facts);
        expect(validateContract(RESULT, factsOnly).errors).toEqual([]);

        const evidenceOnly = unsupported();
        evidenceOnly.evidence_ref_ids = structuredClone(canonicalResult.evidence_ref_ids);
        expect(validateContract(RESULT, evidenceOnly).errors).toEqual([]);
    });

    it("the key is still required: an unsupported result with the answer key removed rejects", () => {
        const missing = unsupported();
        delete missing.deterministic_answer;
        const validation = validateContract(RESULT, missing);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join("; ")).toMatch(/deterministic_answer/);
    });

    /**
     * Reproduces the PRIOR pin's own validator (d949d18c, on origin/main
     * before this PR): the new `allOf` entry stripped back out and the
     * unconditional `minLength: 1` restored. acr's own unsupported example
     * is REJECTED there -- the exact document an un-bumped consumer would
     * have turned into `acr_contract_violation` once acr emits it. Without
     * this arm the tests above prove only that the new schema accepts the
     * empty form, never that the BUMP is what made it acceptable.
     */
    it("EXECUTED repro: the prior pin's own schema rejects acr's unsupported example on the answer alone", () => {
        const priorResultSchema = structuredClone(investigationResultSchema) as unknown as {
            properties: { deterministic_answer: Record<string, unknown> };
            allOf: Record<string, unknown>[];
        };
        const newEntries = priorResultSchema.allOf.filter((entry) =>
            JSON.stringify(entry).includes('"deterministic_answer"'),
        );
        expect(newEntries).toHaveLength(1);
        priorResultSchema.allOf = priorResultSchema.allOf.filter(
            (entry) => !newEntries.includes(entry),
        );
        priorResultSchema.properties.deterministic_answer.minLength = 1;

        const ajv = new Ajv2020({ allErrors: true, strictSchema: false, strictTypes: false });
        ajv.addSchema(commonSchema, "context_fabric_common.v1.schema.json");
        const validate = ajv.compile(priorResultSchema);

        expect(validate(unsupportedResult)).toBe(false);
        expect(
            (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ""}`),
        ).toEqual([EMPTY_ANSWER_ERROR]);
    });
});
