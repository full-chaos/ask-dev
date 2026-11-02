/**
 * The ACR event stream, as the e2e double writes it (CHAOS-12106): `accepted`, then one terminal,
 * `result` or `error`. Every frame is `id`, `event`, one line of compact JSON and a blank line, and
 * validates against `context_fabric_investigation_event.v1` (the app checks each one). Plain
 * `.mjs`, so the fake server (plain Node) and the specs (the Playwright transform) both load it.
 */
const SCHEMA = "context_fabric_investigation_event.v1";
const REQUEST_ID = "req_e2e_stream_0001";

function frame(event) {
    return `id: ${String(event.seq)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** `accepted` names back the ids the request sent, as ACR does. */
function accepted({ reservedResultId, submissionId, threadId }) {
    return {
        schema_version: SCHEMA,
        type: "accepted",
        request_id: REQUEST_ID,
        seq: 1,
        reserved_result_id: reservedResultId,
        ...(submissionId === undefined ? {} : { submission_id: submissionId }),
        ...(threadId === undefined ? {} : { thread_id: threadId }),
        started_at: new Date().toISOString(),
        budget_seconds: 120,
    };
}

/** The stream of an answered investigation. */
export function resultStream({ result, submissionId, threadId }) {
    const head = accepted({ reservedResultId: result.result_id, submissionId, threadId });
    return (
        frame(head) +
        frame({ schema_version: SCHEMA, type: "result", request_id: REQUEST_ID, seq: 2, result })
    );
}

/** An `error.v1` envelope. */
export function errorEnvelope({ code, status, retryable = false, message = "refused" }) {
    return {
        schema_version: "error.v1",
        request_id: REQUEST_ID,
        error: { code, message, http_status: status, retryable },
    };
}

/** The stream of an investigation that failed after it was accepted. */
export function errorStream({ code, status, retryable, submissionId, threadId }) {
    const reservedResultId = "result_e2e_failed_0001";
    return (
        frame(accepted({ reservedResultId, submissionId, threadId })) +
        frame({
            schema_version: SCHEMA,
            type: "error",
            request_id: REQUEST_ID,
            seq: 2,
            reserved_result_id: reservedResultId,
            error: errorEnvelope({ code, status, retryable }),
        })
    );
}
