/**
 * Validates payloads against the PINNED ACR JSON Schemas.
 *
 * This is PRODUCT code, not a test helper (CHAOS-3738). Two things depend on it:
 *
 *   1. The server hop validates every investigation result ACR returns before
 *      handing it to the UI. A result that does not satisfy its own contract is
 *      an upstream failure, and the Workbench reports it as one rather than
 *      rendering a half-understood payload as if it were an answer.
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
import errorSchema from "@/contracts/schemas/error.v1.schema.json";

export const CONTRACT_SCHEMAS = {
    "context_fabric_common.v1.schema.json": commonSchema,
    "context_fabric_investigation_request.v1.schema.json": investigationRequestSchema,
    "context_fabric_investigation_result.v1.schema.json": investigationResultSchema,
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
for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) ajv.addSchema(schema, name);

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
