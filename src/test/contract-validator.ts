/**
 * Validates values against the PINNED ACR JSON Schemas.
 *
 * Test-scoped on purpose. The workbench is a read-only consumer that renders
 * what it is given; it does not gate, authorize, or re-judge anything at
 * runtime (CHAOS-3738 boundary). Schema validation is a build-time guard that
 * the committed mock fixtures still speak the contract's vocabulary — so `ajv`
 * stays a devDependency and never reaches the shipped bundle.
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
