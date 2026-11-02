import { readFileSync } from "node:fs";
import path from "node:path";

import type { StreamEnvelopeValidators, StreamValidators } from "../transport";

/**
 * Investigation event stream fixtures for the browser ACR transport tests (CHAOS-12104; ported from
 * web #1608, CHAOS-11925).
 *
 * `context_fabric_investigation_event_stream.v1.sse` is a real producer capture: the raw bytes ACR
 * (acr main eabe6e6c, kiac askdev-1, stream flag on) wrote for one investigation on 2026-10-30 —
 * accepted, all five stages, two heartbeats, the result. Only the `result` payload was swapped for
 * the vendored canonical result capture (`context_fabric_investigation_result.v1.json`), so no
 * organization data enters the repository; every frame, id, seq, timestamp and the framing bytes
 * are ACR's own.
 */
export const STREAM_CAPTURE = readFileSync(
    path.join(import.meta.dirname, "captures/context_fabric_investigation_event_stream.v1.sse"),
    "utf8",
);

type EventObject = Record<string, unknown> & { readonly seq: number; readonly type: string };

/** The captured events, in order, as ACR wrote them. */
export const CAPTURED_EVENTS: readonly EventObject[] = STREAM_CAPTURE.split("\n\n")
    .filter((frame) => frame !== "")
    .map((frame) => {
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data === undefined) throw new Error("capture frame without data");
        return JSON.parse(data.slice("data: ".length)) as EventObject;
    });

function captured(type: string): EventObject {
    const event = CAPTURED_EVENTS.find((candidate) => candidate.type === type);
    if (event === undefined) throw new Error(`capture has no ${type} event`);
    return event;
}

const ACCEPTED = captured("accepted");
const BASE = { request_id: ACCEPTED.request_id, schema_version: ACCEPTED.schema_version };

/** One frame as ACR writes it: `id`, `event`, one line of compact JSON, a blank line. */
export function acrFrame(event: EventObject): string {
    return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function acceptedEvent(): EventObject {
    return { ...ACCEPTED };
}

export function stageEvent(seq: number, stage: string, state: string, elapsedMs: number) {
    return { ...BASE, elapsed_ms: elapsedMs, seq, stage, state, type: "stage" };
}

export function heartbeatEvent(seq: number, elapsedMs: number): EventObject {
    return { ...BASE, elapsed_ms: elapsedMs, seq, type: "heartbeat" };
}

export function resultEvent(seq: number): EventObject {
    return { ...captured("result"), seq };
}

export function errorEvent(seq: number, code = "internal_error"): EventObject {
    return {
        ...BASE,
        error: {
            error: { code, http_status: 500, message: "redacted", retryable: false },
            request_id: ACCEPTED.request_id,
            schema_version: "error.v1",
        },
        reserved_result_id: ACCEPTED.reserved_result_id,
        seq,
        type: "error",
    };
}

/** ACR frames for the given events, joined. */
export function acrStream(...events: readonly EventObject[]): string {
    return events.map(acrFrame).join("");
}

/** The result and status types of these tests: a host names its own. */
export type TestResult = Record<string, unknown>;
export type TestStatus = Record<string, unknown>;

const STATUSES = new Set(["complete", "partial", "degraded", "clarification_required", "no_match"]);
const ARRAY_FIELDS = [
    "strongest_pressures",
    "drivers",
    "remaining_work",
    "readiness_gaps",
    "conflicts",
    "limitations",
    "warnings",
    "evidence_ref_ids",
] as const;
const STRING_FIELDS = [
    "result_id",
    "question",
    "deterministic_answer",
    "direct_judgment",
    "current_state",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A test copy of the web host's `asTranscriptResult` (`testModeAnswer.ts`): the fields its views
 * read, checked for shape. A result they cannot read is rejected, whatever the schema says.
 */
export function asResult(value: unknown): TestResult | null {
    if (!isRecord(value)) return null;
    if (typeof value.status !== "string" || !STATUSES.has(value.status)) return null;
    if (!STRING_FIELDS.every((field) => typeof value[field] === "string")) return null;
    if (!ARRAY_FIELDS.every((field) => Array.isArray(value[field]))) return null;
    if (!isRecord(value.versions)) return null;
    if (!isRecord(value.subject_resolution)) return null;
    if (!isRecord(value.coverage) || !Array.isArray(value.coverage.sources)) return null;
    if (!isRecord(value.interpretation) || typeof value.interpretation.shape !== "string")
        return null;
    return value;
}

/**
 * Stubs for the checks a host loads. ask-dev does not vendor the event or the status schemas, so
 * these pass any value of the right outline, and a test makes one return false with `rejecting`.
 * A test whose point is that the real schema refuses a real shape belongs to the host (web).
 */
const envelope: StreamEnvelopeValidators = {
    // The outline the gate reads: a record with a `type`, a `seq` and a `request_id`.
    validateInvestigationEventEnvelope: (value) =>
        isRecord(value) &&
        typeof value.type === "string" &&
        typeof value.seq === "number" &&
        typeof value.request_id === "string",
    validateSubmissionStatus: isRecord,
    // `error.v1` without its schema: the keys the transport and the stores read.
    validateErrorEnvelope: (value) => {
        if (!isRecord(value) || value.schema_version !== "error.v1") return false;
        const error = value.error;
        return (
            typeof value.request_id === "string" &&
            isRecord(error) &&
            typeof error.code === "string" &&
            typeof error.message === "string" &&
            typeof error.http_status === "number" &&
            typeof error.retryable === "boolean"
        );
    },
};

const full: StreamValidators = {
    validateInvestigationEvent: () => true,
    validateInvestigationResultV1: () => true,
    validateInvestigationResultV2: () => true,
};

/** The same checks, with `name` returning false for every value. */
function rejecting<T extends object>(checks: T, name: keyof T): T {
    return { ...checks, [name]: () => false };
}

export const validators = { envelope, full, rejecting };
