import type { AcrError } from "@/lib/contracts";

/**
 * Budget refusals as ACR's own route wrote them: `error.v1` bodies, 413. ask-dev holds no capture of
 * its own, so these are the `error` frames of web's encoder captures
 * (`src/components/ask-dev/answer/__tests__/captures/acr_encoder_budget_refusal_*.event.json`),
 * copied as served. `AskDevChat.refusal.test.tsx` holds them against the pinned schema. Tests only.
 */
export const REFUSAL_BYTES_EVIDENCE_WINDOW = {
    schema_version: "error.v1",
    request_id: "req_0123456789abcdef0123456789abcdef",
    error: {
        code: "budget_refusal",
        message: "The Context Fabric answer did not fit the response budget",
        http_status: 413,
        retryable: false,
        details: {
            max_items: 30,
            max_serialized_bytes: 262144,
            measured_bytes: 301877,
            measured_items: 22,
            narrower_continuation: { axis: "evidence_window", family: "subject_investigation" },
            nothing_left_to_cut: true,
            overrun: "bytes",
            question_family: "subject_investigation",
            retry_attempted: false,
        },
    },
} as const satisfies AcrError;

export const REFUSAL_ITEMS_RESULT_COUNT = {
    schema_version: "error.v1",
    request_id: "req_0123456789abcdef0123456789abcdef",
    error: {
        code: "budget_refusal",
        message: "The Context Fabric answer did not fit the response budget",
        http_status: 413,
        retryable: false,
        details: {
            max_items: 30,
            max_serialized_bytes: 262144,
            measured_bytes: 0,
            measured_items: 41,
            narrower_continuation: { axis: "result_count", family: "discovered_cohort_ranking" },
            overrun: "items",
            question_family: "discovered_cohort_ranking",
            retry_attempted: true,
        },
    },
} as const satisfies AcrError;

export const REFUSAL_ITEMS_NO_AXIS = {
    schema_version: "error.v1",
    request_id: "req_0123456789abcdef0123456789abcdef",
    error: {
        code: "budget_refusal",
        message: "The Context Fabric answer did not fit the response budget",
        http_status: 413,
        retryable: false,
        details: {
            max_items: 30,
            max_serialized_bytes: 262144,
            measured_bytes: 0,
            measured_items: 41,
            overrun: "items",
            question_family: "unclassified",
            retry_attempted: true,
        },
    },
} as const satisfies AcrError;
