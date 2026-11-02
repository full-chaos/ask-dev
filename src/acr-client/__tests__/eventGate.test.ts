import { describe, expect, it } from "vitest";

import { InvestigationEventGate, type GateVerdict } from "../eventGate";
import { SseParser, type SseEvent } from "../sseParser";
import { MAX_EVENT_BYTES } from "../limits";
import {
    acceptedEvent,
    acrFrame,
    CAPTURED_EVENTS,
    errorEvent,
    heartbeatEvent,
    resultEvent,
    stageEvent,
    isResult,
    validators,
    type TestResult,
} from "./eventFixtures";

const validateInvestigationEventEnvelope = validators.envelope.validateInvestigationEventEnvelope;

/**
 * CHAOS-12104 (T14a): the browser's stream grammar, on the real ACR capture (#1608) and on edits
 * of it, through a stub of the envelope check of `context_fabric_investigation_event.v1` (the host's
 * generated check is the one the transport gives the gate; the full check of a result is the
 * transport's, option (c)).
 */

const THREAD = "thread_e2e_gate_00000001";
const ACCEPTED = acceptedEvent();
const SUBMISSION = String(ACCEPTED.submission_id);
/** ACR writes `thread_id` in `accepted` since T9; the capture predates it, so it is added. */
const accepted = () => ({ ...acceptedEvent(), thread_id: THREAD });

type EventObject = Record<string, unknown> & { readonly seq: number; readonly type: string };

const frameOf = (event: EventObject): SseEvent => {
    const parser = new SseParser(MAX_EVENT_BYTES);
    const [frame] = parser.push(new TextEncoder().encode(acrFrame(event)));
    return frame!;
};

function gate(validate: (value: unknown) => boolean = validateInvestigationEventEnvelope) {
    return new InvestigationEventGate(validate, isResult, {
        threadId: THREAD,
        submissionId: SUBMISSION,
    });
}

/** Feeds events in order and returns each verdict. */
function feed(events: readonly EventObject[], g = gate()): GateVerdict<TestResult>[] {
    return events.map((event) => g.accept(frameOf(event)));
}

const kinds = (verdicts: readonly GateVerdict<TestResult>[]) =>
    verdicts.map((v) => (v.kind === "invalid" ? `invalid:${v.reason}` : v.kind));

/** The captured run, `accepted` with its thread. */
const CAPTURED = CAPTURED_EVENTS.map((event, index) =>
    index === 0 ? { ...event, thread_id: THREAD } : event,
) as EventObject[];

describe("the real capture passes, every event in order", () => {
    it("passes every captured event and ends on the result", () => {
        const g = gate();
        const verdicts = feed(CAPTURED, g);
        expect(kinds(verdicts).every((kind) => kind === "event")).toBe(true);
        expect(verdicts.at(-1)).toMatchObject({ kind: "event", terminal: true });
        expect(verdicts.slice(0, -1).every((v) => v.kind === "event" && !v.terminal)).toBe(true);
        expect(g.ended).toBe(true);
        expect(g.lastSeq).toBe(CAPTURED.at(-1)!.seq);
    });

    it("passes ACR's stage rules: a heartbeat naming the open stage, an error naming the last stage started, 11 s of silence", () => {
        const verdicts = feed([
            accepted(),
            heartbeatEvent(2, 11_000),
            stageEvent(3, "interpreting", "started", 11_005),
            { ...heartbeatEvent(4, 22_005), stage: "interpreting" },
            stageEvent(5, "interpreting", "completed", 22_010),
            heartbeatEvent(6, 33_010),
            { ...errorEvent(7), stage: "interpreting" },
        ]);
        expect(kinds(verdicts)).toEqual(Array(7).fill("event"));
        expect(verdicts.at(-1)).toMatchObject({ kind: "event", terminal: true });
    });

    it("passes a result once the open stage completed", () => {
        const verdicts = feed([
            accepted(),
            stageEvent(2, "interpreting", "started", 5),
            stageEvent(3, "interpreting", "completed", 6),
            resultEvent(4),
        ]);
        expect(verdicts.at(-1)).toMatchObject({ kind: "event", terminal: true });
    });

    it("lets a reused result's nested request_id differ from the stream's", () => {
        const result = resultEvent(2) as EventObject & { result: Record<string, unknown> };
        const reused = { ...result, result: { ...result.result, request_id: "req_other_run" } };
        expect(kinds(feed([accepted(), reused]))).toEqual(["event", "event"]);
    });
});

describe("any break before a terminal is invalid", () => {
    const cases: [string, EventObject[], string][] = [
        [
            "a first event that is not accepted",
            [stageEvent(1, "interpreting", "started", 5)],
            "first_not_accepted",
        ],
        ["accepted with seq 2", [{ ...accepted(), seq: 2 }], "first_not_accepted"],
        ["a second accepted", [accepted(), { ...accepted(), seq: 2 }], "accepted_repeated"],
        ["a seq gap", [accepted(), stageEvent(3, "interpreting", "started", 5)], "seq_gap"],
        ["a repeated seq", [accepted(), heartbeatEvent(2, 10), heartbeatEvent(2, 11)], "seq_gap"],
        [
            "another request_id",
            [accepted(), { ...heartbeatEvent(2, 10), request_id: "req_other" }],
            "request_id_changed",
        ],
        [
            "elapsed going back",
            [accepted(), heartbeatEvent(2, 50), heartbeatEvent(3, 40)],
            "elapsed_regressed",
        ],
        [
            "a stage started twice",
            [
                accepted(),
                stageEvent(2, "interpreting", "started", 5),
                stageEvent(3, "interpreting", "started", 6),
            ],
            "stage_order",
        ],
        [
            "a stage completed that never started",
            [accepted(), stageEvent(2, "reading_facts", "completed", 5)],
            "stage_order",
        ],
        [
            "an earlier stage after a later one",
            [
                accepted(),
                stageEvent(2, "reading_facts", "started", 5),
                stageEvent(3, "reading_facts", "completed", 6),
                stageEvent(4, "interpreting", "started", 7),
            ],
            "stage_order",
        ],
        [
            "a stage started while another is open",
            [
                accepted(),
                stageEvent(2, "interpreting", "started", 5),
                stageEvent(3, "synthesizing", "started", 6),
            ],
            "stage_order",
        ],
        // ACR's stream check (`ContextFabricInvestigationEventStreamCheck`): codex r2.
        [
            "a result while a stage is open",
            [accepted(), stageEvent(2, "interpreting", "started", 5), resultEvent(3)],
            "result_stage_open",
        ],
        [
            "a heartbeat naming no stage while one is open",
            [accepted(), stageEvent(2, "interpreting", "started", 5), heartbeatEvent(3, 10)],
            "heartbeat_stage",
        ],
        [
            "a heartbeat naming a stage while none is open",
            [accepted(), { ...heartbeatEvent(2, 10), stage: "interpreting" }],
            "heartbeat_stage",
        ],
        [
            "an error naming no stage after one started",
            [
                accepted(),
                stageEvent(2, "interpreting", "started", 5),
                stageEvent(3, "interpreting", "completed", 6),
                errorEvent(4),
            ],
            "error_stage",
        ],
        [
            "an error naming a stage when none started",
            [accepted(), { ...errorEvent(2), stage: "interpreting" }],
            "error_stage",
        ],
        [
            "more than 11 s between two elapsed_ms values (accepted counts as 0)",
            [accepted(), heartbeatEvent(2, 11_001)],
            "silence",
        ],
        [
            "more than 11 s between two later elapsed_ms values",
            [accepted(), heartbeatEvent(2, 10_000), heartbeatEvent(3, 21_001)],
            "silence",
        ],
        [
            "an error naming another reserved result",
            [accepted(), { ...errorEvent(2), reserved_result_id: "result_other_reserved" }],
            "reserved_mismatch",
        ],
        ["accepted with no thread", [acceptedEvent()], "thread_mismatch"],
        [
            "accepted with another thread",
            [{ ...accepted(), thread_id: "thread_other" }],
            "thread_mismatch",
        ],
        [
            "accepted with another submission",
            [{ ...accepted(), submission_id: "sub_other" }],
            "submission_mismatch",
        ],
    ];
    // The pinned schema: on accepted, submission_id is optional ("echoed once the route binds the
    // investigation to a submission"). So a missing one is accepted; another one is not.
    it("accepts an accepted event with no submission id (the schema makes it optional)", () => {
        expect(accepted()).toHaveProperty("submission_id", SUBMISSION);
        const withoutSubmission: EventObject = { ...accepted() };
        delete withoutSubmission.submission_id;
        expect(feed([withoutSubmission])).toEqual([expect.objectContaining({ kind: "event" })]);
    });

    for (const [name, events, reason] of cases) {
        it(name, () => {
            const verdicts = feed(events);
            expect(verdicts.slice(0, -1).every((v) => v.kind === "event")).toBe(true);
            expect(verdicts.at(-1)).toMatchObject({ kind: "invalid", reason });
        });
    }

    it("a skipped stage is fine", () => {
        const verdicts = feed([
            accepted(),
            stageEvent(2, "interpreting", "started", 5),
            stageEvent(3, "interpreting", "completed", 6),
            stageEvent(4, "synthesizing", "started", 7),
            stageEvent(5, "synthesizing", "completed", 8),
            resultEvent(6),
        ]);
        expect(kinds(verdicts)).toEqual(["event", "event", "event", "event", "event", "event"]);
    });

    it("the SSE event and id fields must name the event's type and seq", () => {
        const g = gate();
        expect(g.accept(frameOf(accepted())).kind).toBe("event");
        const heartbeat = heartbeatEvent(2, 10);
        const frame = frameOf(heartbeat);
        expect(g.accept({ ...frame, event: "stage" })).toMatchObject({ reason: "event_field" });
        expect(gate().accept({ ...frameOf(accepted()), id: "7" })).toMatchObject({
            reason: "id_field",
        });
    });

    it("bad JSON and a schema break are invalid", () => {
        expect(gate().accept({ event: "accepted", id: "1", data: "{" })).toMatchObject({
            reason: "bad_json",
        });
        // ask-dev stubs the envelope check, so it is made to refuse; the schema's own cases are web's.
        const refusing = validators.rejecting(
            validators.envelope,
            "validateInvestigationEventEnvelope",
        );
        expect(
            gate(refusing.validateInvestigationEventEnvelope).accept(frameOf(accepted())),
        ).toMatchObject({ reason: "schema" });
    });

    it("a schema-valid result the views cannot read is invalid", () => {
        // The projection view is schema-valid in an event, but not a transcript result.
        const g = gate(() => true);
        expect(g.accept(frameOf(accepted())).kind).toBe("event");
        expect(
            g.accept(frameOf({ ...resultEvent(2), result: { projection: true } })),
        ).toMatchObject({ reason: "result_shape" });
    });
});

describe("after the terminal", () => {
    it("a later event is dropped and named, never passed on", () => {
        const verdicts = feed([accepted(), errorEvent(2), heartbeatEvent(3, 10), resultEvent(4)]);
        expect(kinds(verdicts)).toEqual(["event", "event", "after_terminal", "after_terminal"]);
        expect(verdicts[2]).toMatchObject({ eventType: "heartbeat" });
        expect(verdicts[3]).toMatchObject({ eventType: "result" });
    });

    it("names an unknown type `unknown`, never its wire text", () => {
        const g = gate();
        feed([accepted(), errorEvent(2)], g);
        expect(g.accept({ event: "<script>", id: "3", data: '{"type":"evil<b>"}' })).toEqual({
            kind: "after_terminal",
            eventType: "unknown",
        });
    });
});

// CHAOS-12336 (T14b, the lead's ruling 1 = A): an attach after a cursor starts mid-run. The rules
// that need no earlier event hold at once; the stage rules hold from the first stage event on.
describe("an attach after a cursor", () => {
    const resumed = (after = 5) =>
        new InvestigationEventGate(
            validateInvestigationEventEnvelope,
            isResult,
            { submissionId: SUBMISSION },
            { resumeAfter: after },
        );

    it("starts at the event after the cursor, then grows by one", () => {
        expect(
            kinds(feed([heartbeatEvent(6, 40_000), heartbeatEvent(7, 45_000)], resumed())),
        ).toEqual(["event", "event"]);
        expect(kinds(feed([heartbeatEvent(7, 40_000)], resumed()))).toEqual(["invalid:seq_gap"]);
        expect(kinds(feed([heartbeatEvent(5, 40_000)], resumed()))).toEqual(["invalid:seq_gap"]);
        expect(kinds(feed([{ ...accepted(), seq: 6 }], resumed()))).toEqual([
            "invalid:accepted_repeated",
        ]);
    });

    it("takes request_id from its first event and holds it", () => {
        expect(
            kinds(
                feed(
                    [
                        { ...heartbeatEvent(6, 40_000), request_id: "req_resumed" },
                        { ...heartbeatEvent(7, 41_000), request_id: "req_resumed" },
                        { ...heartbeatEvent(8, 42_000), request_id: "req_other" },
                    ],
                    resumed(),
                ),
            ),
        ).toEqual(["event", "event", "invalid:request_id_changed"]);
    });

    it("checks elapsed_ms from its first value on (the store checks the join)", () => {
        expect(
            kinds(feed([heartbeatEvent(6, 90_000), heartbeatEvent(7, 89_000)], resumed())),
        ).toEqual(["event", "invalid:elapsed_regressed"]);
        expect(
            kinds(feed([heartbeatEvent(6, 90_000), heartbeatEvent(7, 101_001)], resumed())),
        ).toEqual(["event", "invalid:silence"]);
    });

    it("before a stage event, the stage rules wait: the open stage is not known", () => {
        expect(
            kinds(
                feed(
                    [
                        { ...heartbeatEvent(6, 40_000), stage: "reading_facts" },
                        heartbeatEvent(7, 41_000),
                    ],
                    resumed(),
                ),
            ),
        ).toEqual(["event", "event"]);
        expect(kinds(feed([{ ...errorEvent(6), stage: "synthesizing" }], resumed()))).toEqual([
            "event",
        ]);
        expect(kinds(feed([resultEvent(6)], resumed()))).toEqual(["event"]);
    });

    it("a stage event after the join re-arms every stage rule", () => {
        const closed = stageEvent(6, "reading_facts", "completed", 40_000);
        // A heartbeat must name no stage now; one naming the stage that closed breaks it.
        expect(
            kinds(
                feed([closed, { ...heartbeatEvent(7, 41_000), stage: "reading_facts" }], resumed()),
            ),
        ).toEqual(["event", "invalid:heartbeat_stage"]);
        // An error names the last stage started: the one that closed.
        expect(
            kinds(feed([closed, { ...errorEvent(7), stage: "interpreting" }], resumed())),
        ).toEqual(["event", "invalid:error_stage"]);
        expect(
            kinds(feed([closed, { ...errorEvent(7), stage: "reading_facts" }], resumed())),
        ).toEqual(["event", "event"]);
        // No earlier stage starts again.
        expect(
            kinds(feed([closed, stageEvent(7, "interpreting", "started", 41_000)], resumed())),
        ).toEqual(["event", "invalid:stage_order"]);
        // A result waits for the open stage to close.
        expect(
            kinds(
                feed(
                    [closed, stageEvent(7, "synthesizing", "started", 41_000), resultEvent(8)],
                    resumed(),
                ),
            ),
        ).toEqual(["event", "event", "invalid:result_stage_open"]);
        // A stage that opens after the join: a heartbeat must name it.
        expect(
            kinds(
                feed(
                    [stageEvent(6, "synthesizing", "started", 40_000), heartbeatEvent(7, 41_000)],
                    resumed(),
                ),
            ),
        ).toEqual(["event", "invalid:heartbeat_stage"]);
    });

    it("with no cursor, an accepted with no submission_id passes: the route is keyed by it (codex r1)", () => {
        // ACR's events route selects the log by the submission id in its URL (and the caller), and
        // the pinned schema makes the echo optional on accepted; another id is still refused below.
        const withoutSubmission: EventObject = { ...accepted() };
        delete withoutSubmission.submission_id;
        expect(
            kinds(
                feed(
                    [withoutSubmission],
                    new InvestigationEventGate(validateInvestigationEventEnvelope, isResult, {
                        submissionId: SUBMISSION,
                    }),
                ),
            ),
        ).toEqual(["event"]);
    });

    it("with no cursor, the whole grammar holds from accepted, and no thread is asked for", () => {
        const fromStart = new InvestigationEventGate(validateInvestigationEventEnvelope, isResult, {
            submissionId: SUBMISSION,
        });
        const verdicts = feed(CAPTURED, fromStart);
        expect(kinds(verdicts).every((kind) => kind === "event")).toBe(true);
        expect(
            kinds(
                feed(
                    [{ ...accepted(), submission_id: "sub_other" }],
                    new InvestigationEventGate(validateInvestigationEventEnvelope, isResult, {
                        submissionId: SUBMISSION,
                    }),
                ),
            ),
        ).toEqual(["invalid:submission_mismatch"]);
    });
});
