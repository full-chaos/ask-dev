import type { StreamEnvelopeValidators, StreamValidators } from "@/acr-client";
import { contractValidator, type ContractSchemaName } from "@/lib/acr/validate";

/**
 * The checks the shared ACR client asks of its host (CHAOS-12106), built from the vendored
 * schemas. The browser validates what ACR sends, so no server hop stands between them.
 *
 * The event schema is the envelope check too: it holds the whole result, and the vendored schemas
 * are small enough to load with the page.
 */

const EVENT = "context_fabric_investigation_event.v1.schema.json";
const STATUS = "context_fabric_submission_status.v1.schema.json";
const ERROR = "error.v1.schema.json";
// The result event carries the response form (the result plus an optional `synthesis_input`).
const RESPONSE_V1 = "context_fabric_investigation_response.v1.schema.json";
const RESPONSE_V2 = "context_fabric_investigation_response.v2.schema.json";

/**
 * A check that keeps the schema's own errors beside a refusal, as a compiled Ajv validator does
 * (CHAOS-12593, codex r2 P2): the transport reads them to log where and by which rule.
 */
const valid = (schema: ContractSchemaName) => {
    const check = Object.assign(
        (value: unknown): boolean => {
            const validator = contractValidator(schema);
            const ok = validator !== undefined && validator(value) === true;
            check.errors = ok ? null : (validator?.errors ?? null);
            return ok;
        },
        { errors: null } as { errors: unknown },
    );
    return check;
};

export const streamEnvelopeValidators: StreamEnvelopeValidators = {
    validateInvestigationEventEnvelope: valid(EVENT),
    validateSubmissionStatus: valid(STATUS),
    validateErrorEnvelope: valid(ERROR),
};

const streamValidators: StreamValidators = {
    validateInvestigationEvent: valid(EVENT),
    validateInvestigationResultV1: valid(RESPONSE_V1),
    validateInvestigationResultV2: valid(RESPONSE_V2),
};

export const loadStreamValidators = (): Promise<StreamValidators> =>
    Promise.resolve(streamValidators);
