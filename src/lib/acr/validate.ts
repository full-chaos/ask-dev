/**
 * Validates payloads against the PINNED ACR JSON Schemas.
 *
 * This is PRODUCT code, not a test helper (CHAOS-3738). Two things depend on it:
 *
 *   1. The browser validates every event and investigation result ACR sends
 *      before handing it to the UI (CHAOS-12106: no server hop stands between
 *      them). A result that does not satisfy its own contract is an upstream
 *      failure, and the Workbench reports it as one rather than rendering a
 *      half-understood payload as if it were an answer. It is importable in
 *      the browser: the schemas are bundled, nothing is fetched.
 *   2. M3's enrichment adapter validates the whole presentation composition
 *      before rendering, and falls closed to the deterministic view.
 *
 * Validating an incoming payload is not authoring one — the Workbench still
 * originates no fact, metric, health state, or judgment (CHAOS-3738 boundary).
 */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import commonSchema from "@/contracts/schemas/context_fabric_common.v1.schema.json";
import investigationRequestSchema from "@/contracts/schemas/context_fabric_investigation_request.v1.schema.json";
import investigationResultSchema from "@/contracts/schemas/context_fabric_investigation_result.v1.schema.json";
import investigationResultV2Schema from "@/contracts/schemas/context_fabric_investigation_result.v2.schema.json";
import answerProjectionSchema from "@/contracts/schemas/context_fabric_answer_projection.v1.schema.json";
import investigationEventSchema from "@/contracts/schemas/context_fabric_investigation_event.v1.schema.json";
import investigationResponseSchema from "@/contracts/schemas/context_fabric_investigation_response.v1.schema.json";
import investigationResponseV2Schema from "@/contracts/schemas/context_fabric_investigation_response.v2.schema.json";
import submissionStatusSchema from "@/contracts/schemas/context_fabric_submission_status.v1.schema.json";
import errorSchema from "@/contracts/schemas/error.v1.schema.json";

export const CONTRACT_SCHEMAS = {
    "context_fabric_common.v1.schema.json": commonSchema,
    "context_fabric_investigation_request.v1.schema.json": investigationRequestSchema,
    "context_fabric_investigation_result.v1.schema.json": investigationResultSchema,
    "context_fabric_investigation_result.v2.schema.json": investigationResultV2Schema,
    "context_fabric_investigation_event.v1.schema.json": investigationEventSchema,
    "context_fabric_answer_projection.v1.schema.json": answerProjectionSchema,
    "context_fabric_investigation_response.v1.schema.json": investigationResponseSchema,
    "context_fabric_investigation_response.v2.schema.json": investigationResponseV2Schema,
    "context_fabric_submission_status.v1.schema.json": submissionStatusSchema,
    "error.v1.schema.json": errorSchema,
} as const;

export type ContractSchemaName = keyof typeof CONTRACT_SCHEMAS;

export type ValidationResult = {
    readonly valid: boolean;
    readonly errors: readonly string[];
};

const ajv = new Ajv2020({
    allErrors: true,
    strictRequired: false,
    strictSchema: true,
    strictTypes: false,
});
addFormats(ajv);
// Annotation-only keyword the pinned schemas use for open vocabularies
// ("documented values; a client must tolerate values it does not know").
// It carries no validation semantics, so unknown values stay valid.
ajv.addKeyword({ keyword: "x-documented-values", schemaType: "array" });
for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) ajv.addSchema(schema, name);

/**
 * The compiled validator of one schema, so a caller can keep Ajv's own `errors` beside a refusal
 * (CHAOS-12593: the transport logs where and by which rule the pinned contract refused).
 */
export function contractValidator(schema: ContractSchemaName) {
    return ajv.getSchema(schema);
}

export function validateContract(schema: ContractSchemaName, value: unknown): ValidationResult {
    const validator = ajv.getSchema(schema);
    if (validator === undefined)
        return { valid: false, errors: [`schema is unavailable: ${schema}`] };
    if (validator(value)) return { valid: true, errors: [] };
    return {
        valid: false,
        errors: (validator.errors ?? []).map(
            (error) => `${error.instancePath} ${error.message ?? error.keyword}`,
        ),
    };
}

/**
 * Validates a single string against the SAME `format: "date-time"` rule
 * `ajv-formats` enforces everywhere else in this file — a strict RFC 3339
 * check, not the looser `Date.parse`, which accepts values the pinned
 * schema rejects (`"2026-01-01"`, `"2026-01-01T00:00:00"` with no offset).
 * Exists so a caller's eager conversation-turn validation matches the contract it stands in for, rather than an
 * independently-drifting approximation of it (codex review round 2).
 */
const dateTimeValidator = ajv.compile({ type: "string", format: "date-time" });
export function isDateTimeFormatted(value: string): boolean {
    return dateTimeValidator(value);
}
