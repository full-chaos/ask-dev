/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- ported web test: its fakes return promises and read untyped JSON on purpose */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logger", () => ({ logger: log }));

import type { AcrAccessToken, AcrSilentOutcome } from "../auth";
import type { AcrBrowserClientConfig } from "../config";
import { MAX_EVENT_BYTES, MAX_STREAM_BYTES } from "../limits";
import { createAcrCalls, type AcrCalls } from "../transport";
import {
    TransportFailure,
    TransportRefusal,
    type InvestigateCall,
    type InvestigationEvent,
} from "../types";
import {
    acceptedEvent,
    acrFrame,
    isResult,
    CAPTURED_EVENTS,
    errorEvent,
    heartbeatEvent,
    resultEvent,
    stageEvent,
    validators,
    type TestResult,
    type TestStatus,
} from "./eventFixtures";

const streamEnvelopeValidators = validators.envelope;
const streamValidators = validators.full;

type Calls = AcrCalls<TestResult, TestStatus>;
type RunEvent = InvestigationEvent<TestResult>;

/**
 * CHAOS-12104 (T14a): the browser's ACR transport against a fake `fetch` with real `Response`
 * streams: the request it sends, the deadline rules, the caps, the grammar, the refusals, the
 * status and replay calls, and the members T14b serves.
 */

const ISSUER = "https://acr.example.test";
const CONFIG: AcrBrowserClientConfig = {
    issuer: ISSUER,
    webOrigin: "https://web.example.test",
    clientId: "https://web.example.test/oauth/acr-client.json",
    redirectUri: "https://web.example.test/ask-dev/oauth/callback",
    usesMetadataDocument: true,
};
const TOKEN = "fcacr_test_token_0000000000000000000000000000000";
const THREAD = "thread_browser_test_0001";
const ACCEPTED = acceptedEvent();
const SUBMISSION = String(ACCEPTED.submission_id);
const T0 = 1_800_000_000_000;

type EventObject = Record<string, unknown> & { readonly seq: number; readonly type: string };
const accepted = (): EventObject => ({ ...acceptedEvent(), thread_id: THREAD });
const CAPTURED = CAPTURED_EVENTS.map((event, index) =>
    index === 0 ? { ...event, thread_id: THREAD } : event,
) as EventObject[];

let now: number;
let token: AcrAccessToken;
let fetchMock: ReturnType<typeof vi.fn>;
/** What the transport told the token store ACR refused (CHAOS-12305). */
let rejected: ReturnType<typeof vi.fn<(token: string) => void>>;
/** What the silent step answers; off, so a test here sees "authorization required" (CHAOS-12474). */
const authorizeAnswer = (): AcrSilentOutcome => ({ kind: "off" });

/** A controllable SSE body: push bytes, close, or leave it open. */
function sseBody() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c;
        },
        cancel: cancelled,
    });
    const encoder = new TextEncoder();
    return {
        stream,
        cancelled,
        push: (text: string | Uint8Array) =>
            controller.enqueue(typeof text === "string" ? encoder.encode(text) : text),
        close: () => controller.close(),
    };
}

const sseResponse = (stream: ReadableStream<Uint8Array>, status = 200) =>
    new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });

const jsonResponse = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });

function transport(): Calls {
    return createAcrCalls<TestResult, TestStatus>(CONFIG, {
        fetch: fetchMock as unknown as typeof fetch,
        now: () => now,
        token: () => token,
        rejected: (refused: string) => rejected(refused),
        authorize: async () => authorizeAnswer(),
        envelope: streamEnvelopeValidators,
        isResult,
        validators: async () => streamValidators,
    });
}

/** A transport whose checks are the given ones (a test makes one return false). */
function transportChecking(
    envelope: typeof streamEnvelopeValidators,
    full: typeof streamValidators,
): Calls {
    return createAcrCalls<TestResult, TestStatus>(CONFIG, {
        fetch: fetchMock as unknown as typeof fetch,
        now: () => now,
        token: () => token,
        rejected: (refused: string) => rejected(refused),
        authorize: async () => authorizeAnswer(),
        envelope,
        isResult,
        validators: async () => full,
    });
}

function call(signal = new AbortController().signal, deadline = T0 + 120_000): InvestigateCall {
    return {
        request: {
            request_id: "req_browser_test",
            question: "Which projects are at risk?",
        },
        submissionId: SUBMISSION,
        threadId: THREAD,
        deadline,
        signal,
    };
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
    const out: RunEvent[] = [];
    for await (const event of events) out.push(event);
    return out;
}

const stream = (...events: EventObject[]) => events.map(acrFrame).join("");

const errorEnvelope = (code: string, status: number) => ({
    schema_version: "error.v1",
    request_id: "req_refused",
    error: { code, message: "refused", http_status: status, retryable: true },
});

beforeEach(() => {
    now = T0;
    token = { kind: "token", token: TOKEN, issuer: ISSUER };
    fetchMock = vi.fn();
    rejected = vi.fn<(token: string) => void>();
    for (const level of Object.values(log)) level.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("investigate: the request", () => {
    it("POSTs to ACR with the stream headers, the bearer, no cookie and no token in the URL", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(...CAPTURED));
        body.close();
        await collect(transport().investigate(call()));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${ISSUER}/api/v1/context-fabric/investigations`);
        expect(url).not.toContain(TOKEN);
        expect(init).toMatchObject({
            method: "POST",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
        });
        expect(init.headers).toEqual({
            Authorization: `Bearer ${TOKEN}`,
            "X-ACR-Resource": ISSUER,
            "X-ACR-Client-Version": "0.1.0",
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "X-ACR-Submission-ID": SUBMISSION,
            "X-ACR-Thread-ID": THREAD,
            "X-ACR-Wait-Budget-Seconds": "115",
        });
        expect(JSON.parse(init.body as string)).toEqual(call().request);
    });

    it("sends the budget left of D when the call is sent: floor(D - now - 5 s)", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.close();
        await collect(transport().investigate(call(undefined, T0 + 47_900)));
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["X-ACR-Wait-Budget-Seconds"]).toBe("42");
    });

    it("below ACR's minimum budget: budget_exhausted, and nothing is sent or read", async () => {
        const read = vi.fn(() => token);
        const t = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => now,
            token: read,
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: streamEnvelopeValidators,
            isResult,
            validators: async () => streamValidators,
        });
        await expect(collect(t.investigate(call(undefined, T0 + 14_999)))).rejects.toEqual(
            new TransportFailure("budget_exhausted"),
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
    });

    it("with no in-memory token: authorization_required, and nothing is sent", async () => {
        for (const held of [{ kind: "authorization_required" }, { kind: "off" }] as const) {
            token = held;
            await expect(collect(transport().investigate(call()))).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("awaits an async token store (c4 makes it async)", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.close();
        const t = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => now,
            token: async () => ({ kind: "token", token: TOKEN, issuer: ISSUER }),
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: streamEnvelopeValidators,
            isResult,
            validators: async () => streamValidators,
        });
        await collect(t.investigate(call()));
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    });
});

describe("investigate: the stream", () => {
    it("yields the captured run in order and stops at the result", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(...CAPTURED));
        const events = await collect(transport().investigate(call()));
        expect(events.map((event) => event.seq)).toEqual(CAPTURED.map((event) => event.seq));
        expect(events.at(-1)?.type).toBe("result");
        // The stream was left open after the result: the transport closed it.
        expect(body.cancelled).toHaveBeenCalled();
    });

    it("gives the same events one byte at a time", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        for (const byte of new TextEncoder().encode(stream(...CAPTURED)))
            body.push(Uint8Array.of(byte));
        const events = await collect(transport().investigate(call()));
        expect(events).toHaveLength(CAPTURED.length);
    });

    it("ends without a terminal by returning: the store recovers through the status", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), heartbeatEvent(2, 10)));
        body.close();
        const events = await collect(transport().investigate(call()));
        expect(events.map((event) => event.type)).toEqual(["accepted", "heartbeat"]);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ last_seq: 2 }),
            "ask-dev acr stream ended without a terminal",
        );
    });

    it("a seq gap is invalid_upstream, and the stream is aborted", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), stageEvent(3, "interpreting", "started", 5)));
        const events: RunEvent[] = [];
        await expect(
            (async () => {
                for await (const event of transport().investigate(call())) events.push(event);
            })(),
        ).rejects.toEqual(new TransportFailure("invalid_upstream"));
        expect(events.map((event) => event.type)).toEqual(["accepted"]);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.signal?.aborted).toBe(true);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ reason: "seq_gap", seq: 3 }),
            "ask-dev acr stream broke its grammar",
        );
    });

    it("an event after the terminal, in the same read, is dropped, logged, and the stream closes", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), errorEvent(2), heartbeatEvent(3, 10)));
        const events = await collect(transport().investigate(call()));
        expect(events.map((event) => event.type)).toEqual(["accepted", "error"]);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ event_type: "heartbeat" }),
            "ask-dev acr event after the terminal dropped",
        );
        expect(body.cancelled).toHaveBeenCalled();
    });

    it("an event over the per-event cap is invalid_upstream", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted()));
        body.push(`data: ${"x".repeat(MAX_EVENT_BYTES)}\n\n`);
        await expect(collect(transport().investigate(call()))).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ cap: "event" }),
            "ask-dev acr stream broke its framing",
        );
    });

    it("a stream over the total cap is invalid_upstream", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted()));
        const comment = new TextEncoder().encode(": keepalive\n\n".repeat(80_000));
        const pushes = Math.ceil(MAX_STREAM_BYTES / comment.length) + 1;
        for (let i = 0; i < pushes; i += 1) body.push(comment);
        await expect(collect(transport().investigate(call()))).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ cap: "stream" }),
            "ask-dev acr stream over its cap",
        );
    });

    it("an answer that is not an event stream is invalid_upstream", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ result: true }, 200));
        await expect(collect(transport().investigate(call()))).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
    });
});

describe("investigate: the full checks load in parallel (option (c))", () => {
    function deferredChecks() {
        let resolve!: (value: typeof streamValidators) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<typeof streamValidators>((ok, fail) => {
            resolve = ok;
            reject = fail;
        });
        const validators = vi.fn(() => promise);
        return { promise, resolve, reject, validators };
    }

    function transportWith(load: () => Promise<typeof streamValidators>) {
        return createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => now,
            token: () => token,
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: streamEnvelopeValidators,
            isResult,
            validators: load,
        });
    }

    it("starts loading the full checks at the submit, before the POST answers", async () => {
        const checks = deferredChecks();
        let answer!: (response: Response) => void;
        fetchMock.mockImplementation(() => new Promise<Response>((ok) => (answer = ok)));
        const iterator = transportWith(checks.validators)
            .investigate(call())
            [Symbol.asyncIterator]();
        const first = iterator.next();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(checks.validators).toHaveBeenCalledTimes(1);
        const body = sseBody();
        answer(sseResponse(body.stream));
        body.push(stream(accepted()));
        await expect(first).resolves.toMatchObject({ value: { type: "accepted" } });
        await iterator.return?.(undefined);
    });

    it("checks every progress event before the full checks load; only the result waits for them", async () => {
        const checks = deferredChecks();
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        const iterator = transportWith(checks.validators)
            .investigate(call())
            [Symbol.asyncIterator]();
        body.push(
            stream(
                accepted(),
                stageEvent(2, "interpreting", "started", 5),
                // A heartbeat names the open stage (ACR's stream grammar).
                { ...heartbeatEvent(3, 10), stage: "interpreting" },
                stageEvent(4, "interpreting", "completed", 20),
            ),
        );
        const progress = [];
        for (let i = 0; i < 4; i += 1) progress.push((await iterator.next()).value?.type);
        // The full checks have not loaded, and the progress is already through.
        expect(progress).toEqual(["accepted", "stage", "heartbeat", "stage"]);
        body.push(stream({ ...resultEvent(5) }));
        let resolved = false;
        const terminal = iterator.next().then((step) => {
            resolved = true;
            return step;
        });
        await new Promise((ok) => setTimeout(ok, 20));
        expect(resolved).toBe(false);
        checks.resolve(streamValidators);
        await expect(terminal).resolves.toMatchObject({ value: { type: "result" } });
    });

    it("a result the envelope passes but the full schema refuses is invalid_upstream", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), resultEvent(2)));
        const t = transportWith(async () => ({
            ...streamValidators,
            validateInvestigationEvent: () => false,
        }));
        const events: RunEvent[] = [];
        await expect(
            (async () => {
                for await (const event of t.investigate(call())) events.push(event);
            })(),
        ).rejects.toEqual(new TransportFailure("invalid_upstream"));
        expect(events.map((event) => event.type)).toEqual(["accepted"]);
    });

    it("full checks that fail to load end the run as a dropped call, not as invalid_upstream", async () => {
        const checks = deferredChecks();
        checks.reject(new Error("chunk load failed"));
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), resultEvent(2)));
        const error = await collect(transportWith(checks.validators).investigate(call())).catch(
            (e) => e,
        );
        expect(error).toEqual(new Error("chunk load failed"));
        expect(error).not.toBeInstanceOf(TransportFailure);
    });

    it("the replay starts loading the full checks with its GET", async () => {
        const checks = deferredChecks();
        let answer!: (response: Response) => void;
        fetchMock.mockImplementation(() => new Promise<Response>((ok) => (answer = ok)));
        const result = (resultEvent(9) as unknown as { result: { result_id: string } }).result;
        const replay = transportWith(checks.validators).readResult(
            result.result_id,
            new AbortController().signal,
        );
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(checks.validators).toHaveBeenCalledTimes(1);
        answer(jsonResponse(result, 200));
        checks.resolve(streamValidators);
        await expect(replay).resolves.toEqual(result);
    });
});

describe("investigate: timers", () => {
    it("no response headers within 15 s: admission_timeout", async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_, reject) =>
                    init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
                ),
        );
        const run = collect(transport().investigate(call()));
        const settled = expect(run).rejects.toEqual(new TransportFailure("admission_timeout"));
        await vi.advanceTimersByTimeAsync(14_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await settled;
    });

    it("30 s with no byte once the stream is open: stalled", async () => {
        vi.useFakeTimers();
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted()));
        const events: RunEvent[] = [];
        const run = (async () => {
            for await (const event of transport().investigate(call())) events.push(event);
        })();
        let over = false;
        const settled = expect(
            run.finally(() => {
                over = true;
            }),
        ).rejects.toEqual(new TransportFailure("stalled"));
        await vi.advanceTimersByTimeAsync(29_000);
        // Any byte, a keepalive comment included, starts the 30 s again.
        body.push(": keepalive\n\n");
        await vi.advanceTimersByTimeAsync(29_000);
        expect(over).toBe(false);
        expect(events.map((event) => event.type)).toEqual(["accepted"]);
        await vi.advanceTimersByTimeAsync(1_001);
        await settled;
        expect(over).toBe(true);
    });

    it("an abort from the store aborts the call", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted()));
        const controller = new AbortController();
        const events: RunEvent[] = [];
        const run = (async () => {
            for await (const event of transport().investigate(call(controller.signal))) {
                events.push(event);
                controller.abort(new DOMException("canceled", "AbortError"));
            }
        })();
        await expect(run).rejects.toMatchObject({ name: "AbortError" });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.signal?.aborted).toBe(true);
    });
});

describe("investigate: refusals", () => {
    it("401, and the store gives the same token again: authorization_required, not resent", async () => {
        fetchMock.mockResolvedValue(jsonResponse(errorEnvelope("unauthorized", 401), 401));
        await expect(collect(transport().investigate(call()))).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(rejected.mock.calls).toEqual([[TOKEN]]);
    });

    it("an error.v1 body is a TransportRefusal with its status and Retry-After", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(errorEnvelope("submission_in_progress", 409), 409, { "Retry-After": "7" }),
        );
        const refusal = await collect(transport().investigate(call())).catch((error) => error);
        expect(refusal).toBeInstanceOf(TransportRefusal);
        expect(refusal).toMatchObject({ status: 409, retryAfterSeconds: 7 });
        expect(refusal.error.error.code).toBe("submission_in_progress");
    });

    it("a refusal with no error body is a dropped call (the store recovers it)", async () => {
        fetchMock.mockResolvedValue(new Response("upstream down", { status: 503 }));
        const error = await collect(transport().investigate(call())).catch((e) => e);
        expect(error).not.toBeInstanceOf(TransportRefusal);
        expect(error).not.toBeInstanceOf(TransportFailure);
        expect(error).toBeInstanceOf(Error);
    });

    it("a refusal that is not 401 tells the token store nothing", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse(errorEnvelope("submission_in_progress", 409), 409),
        );
        await expect(collect(transport().investigate(call()))).rejects.toBeInstanceOf(
            TransportRefusal,
        );
        fetchMock.mockResolvedValueOnce(new Response("upstream down", { status: 503 }));
        await expect(collect(transport().investigate(call()))).rejects.toBeInstanceOf(Error);
        expect(rejected).not.toHaveBeenCalled();
    });
});

/**
 * CHAOS-12305 (c4): a 401 tells the token store the token was refused, and reads the token once
 * more. A different token sends the call once more; anything else is "authorization required".
 * At most 2 requests per call.
 */
const NEXT = "fcacr_next_token_00000000000000000000000000000000".slice(0, TOKEN.length);
const held = (value: string): AcrAccessToken => ({ kind: "token", token: value, issuer: ISSUER });
const unauthorized = () => jsonResponse(errorEnvelope("unauthorized", 401), 401);

/** A transport whose token store answers `reads` in order (then "authorization required"). */
function withStore(...reads: Array<AcrAccessToken | (() => AcrAccessToken)>) {
    const read = vi.fn((): AcrAccessToken => {
        const next = reads.shift();
        if (next === undefined) return { kind: "authorization_required" };
        return typeof next === "function" ? next() : next;
    });
    const t = createAcrCalls<TestResult, TestStatus>(CONFIG, {
        fetch: fetchMock as unknown as typeof fetch,
        now: () => now,
        token: read,
        rejected: (refused: string) => rejected(refused),
        authorize: async () => authorizeAnswer(),
        envelope: streamEnvelopeValidators,
        isResult,
        validators: async () => streamValidators,
    });
    return { t, read };
}

const sent = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
        url: url as string,
        body: (init as RequestInit).body,
        headers: (init as RequestInit).headers as Record<string, string>,
    }));

describe("investigate: a 401 is resent at most once, with a new token (CHAOS-12305)", () => {
    it("reports the refused token, reads once more, and resends with the new token and the same submission", async () => {
        const body = sseBody();
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(sseResponse(body.stream));
        body.push(stream(...CAPTURED));
        const { t, read } = withStore(held(TOKEN), held(NEXT));
        const events = await collect(t.investigate(call()));
        expect(events.map((event) => event.seq)).toEqual(CAPTURED.map((event) => event.seq));
        expect(read).toHaveBeenCalledTimes(2);
        expect(rejected.mock.calls).toEqual([[TOKEN]]);
        const [first, second] = sent();
        expect(sent()).toHaveLength(2);
        expect(first!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(second!.headers.Authorization).toBe(`Bearer ${NEXT}`);
        expect(second!.url).toBe(first!.url);
        expect(second!.headers["X-ACR-Submission-ID"]).toBe(SUBMISSION);
        expect(second!.headers["X-ACR-Thread-ID"]).toBe(THREAD);
        expect(second!.body).toBe(first!.body);
    });

    it("a second 401: authorization_required after exactly 2 requests, both tokens reported", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const { t, read } = withStore(held(TOKEN), held(NEXT), held("never read"));
        await expect(collect(t.investigate(call()))).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenCalledTimes(2);
        expect(rejected.mock.calls).toEqual([[TOKEN], [NEXT]]);
    });

    it("the same token, or none, read again: authorization_required after 1 request", async () => {
        for (const again of [
            held(TOKEN),
            { kind: "authorization_required" },
            { kind: "off" },
        ] as AcrAccessToken[]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(async () => unauthorized());
            const { t } = withStore(held(TOKEN), again);
            await expect(collect(t.investigate(call()))).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it("the resend takes the budget left of D when it is sent; below ACR's minimum it is not sent", async () => {
        const body = sseBody();
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(sseResponse(body.stream));
        body.close();
        // The refresh behind the second read took 30 s.
        const late = withStore(held(TOKEN), () => {
            now = T0 + 30_000;
            return held(NEXT);
        });
        await collect(late.t.investigate(call()));
        expect(sent().map((s) => s.headers["X-ACR-Wait-Budget-Seconds"])).toEqual(["115", "85"]);

        now = T0;
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => unauthorized());
        const tooLate = withStore(held(TOKEN), () => {
            now = T0 + 105_001;
            return held(NEXT);
        });
        await expect(collect(tooLate.t.investigate(call()))).rejects.toEqual(
            new TransportFailure("budget_exhausted"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("an abort while the token is read again sends nothing more", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const controller = new AbortController();
        const reason = new DOMException("deadline", "AbortError");
        const { t } = withStore(held(TOKEN), () => {
            controller.abort(reason);
            return held(NEXT);
        });
        await expect(collect(t.investigate(call(controller.signal)))).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("submissionStatus and readResult", () => {
    const signal = new AbortController().signal;
    const statusBody = {
        schema_version: "context_fabric_submission_status.v1",
        submission_id: SUBMISSION,
        state: "done",
        reserved_result_id: String(ACCEPTED.reserved_result_id),
        result_id: String(ACCEPTED.reserved_result_id),
        updated_at: "2026-10-31T12:00:00Z",
    };
    const result = (resultEvent(9) as unknown as { result: unknown }).result;

    it("status: a GET with the bearer and no cookie, checked against the schema", async () => {
        fetchMock.mockResolvedValue(jsonResponse(statusBody, 200));
        await expect(transport().submissionStatus(SUBMISSION, signal)).resolves.toEqual(statusBody);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(
            `${ISSUER}/api/v1/context-fabric/investigations/submissions/${SUBMISSION}`,
        );
        expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
        expect(init.headers).toMatchObject({
            Authorization: `Bearer ${TOKEN}`,
            "X-ACR-Resource": ISSUER,
            "X-ACR-Client-Version": "0.1.0",
        });
    });

    it("status: 404 is null; 401 and no token are authorization_required; a broken body is invalid_upstream", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(errorEnvelope("not_found", 404), 404));
        await expect(transport().submissionStatus(SUBMISSION, signal)).resolves.toBeNull();
        fetchMock.mockResolvedValueOnce(jsonResponse(errorEnvelope("unauthorized", 401), 401));
        await expect(transport().submissionStatus(SUBMISSION, signal)).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        // A body the status check refuses. ask-dev stubs the check: the schema's own cases are web's.
        fetchMock.mockResolvedValueOnce(jsonResponse(statusBody, 200));
        const refusing = transportChecking(
            validators.rejecting(streamEnvelopeValidators, "validateSubmissionStatus"),
            streamValidators,
        );
        await expect(refusing.submissionStatus(SUBMISSION, signal)).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
        token = { kind: "authorization_required" };
        await expect(transport().submissionStatus(SUBMISSION, signal)).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("status and replay: a call aborted before or during the token read sends nothing (codex r2)", async () => {
        const reason = new DOMException("deadline", "AbortError");
        const before = new AbortController();
        before.abort(reason);
        // Aborted before the call: the token store is not even read.
        const tokenRead = vi.fn(() => token);
        const unread = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => now,
            token: tokenRead,
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: streamEnvelopeValidators,
            isResult,
            validators: async () => streamValidators,
        });
        await expect(unread.submissionStatus(SUBMISSION, before.signal)).rejects.toBe(reason);
        await expect(unread.readResult("result_x", before.signal)).rejects.toBe(reason);
        expect(tokenRead).not.toHaveBeenCalled();
        // Aborted while the token store answers.
        for (const read of [
            (t: Calls, s: AbortSignal) => t.submissionStatus(SUBMISSION, s),
            (t: Calls, s: AbortSignal) => t.readResult("result_x", s),
        ]) {
            const during = new AbortController();
            const t = createAcrCalls<TestResult, TestStatus>(CONFIG, {
                fetch: fetchMock as unknown as typeof fetch,
                now: () => now,
                token: async () => {
                    during.abort(reason);
                    return { kind: "token", token: TOKEN, issuer: ISSUER };
                },
                rejected: (refused: string) => rejected(refused),
                authorize: async () => authorizeAnswer(),
                envelope: streamEnvelopeValidators,
                isResult,
                validators: async () => streamValidators,
            });
            await expect(read(t, during.signal)).rejects.toBe(reason);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an abort while an answer's body is read cancels the read and ends with the abort (codex r3)", async () => {
        const reason = new DOMException("deadline", "AbortError");
        const reads: [string, number, (t: Calls, s: AbortSignal) => Promise<unknown>][] = [
            ["status, refused", 503, (t, s) => t.submissionStatus(SUBMISSION, s)],
            ["status, answered", 200, (t, s) => t.submissionStatus(SUBMISSION, s)],
            ["replay, refused", 503, (t, s) => t.readResult("result_x", s)],
            ["replay, answered", 200, (t, s) => t.readResult("result_x", s)],
            [
                "investigate, refused",
                503,
                (t, s) => collect(t.investigate({ ...call(), signal: s })),
            ],
        ];
        const seen: string[] = [];
        for (const [name, status, read] of reads) {
            // A body that starts and never ends.
            const body = sseBody();
            body.push("{");
            fetchMock.mockResolvedValueOnce(
                new Response(body.stream, {
                    status,
                    headers: { "Content-Type": "application/json" },
                }),
            );
            const controller = new AbortController();
            const pending = read(transport(), controller.signal);
            const outcome = pending.then(
                () => "resolved",
                (error: unknown) => error,
            );
            await new Promise((ok) => setTimeout(ok, 5));
            controller.abort(reason);
            const settled = await Promise.race([
                outcome,
                new Promise((ok) => setTimeout(() => ok("still pending"), 200)),
            ]);
            seen.push(
                `${name}: ${settled === reason ? "ended with the abort" : String(settled)}, ${body.cancelled.mock.calls.length > 0 ? "read canceled" : "read left open"}`,
            );
        }
        expect(seen).toEqual(reads.map(([name]) => `${name}: ended with the abort, read canceled`));
    });

    it("an abort that errors the body, as fetch does, ends with the abort, not invalid_upstream", async () => {
        const reason = new DOMException("deadline", "AbortError");
        let source!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
            start(c) {
                source = c;
                c.enqueue(new TextEncoder().encode("{"));
            },
        });
        fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
            init.signal!.addEventListener("abort", () => source.error(init.signal!.reason));
            return new Response(stream, {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });
        const controller = new AbortController();
        const pending = transport().submissionStatus(SUBMISSION, controller.signal);
        const outcome = pending.then(
            () => "resolved",
            (error: unknown) => error,
        );
        await new Promise((ok) => setTimeout(ok, 5));
        controller.abort(reason);
        await expect(outcome).resolves.toBe(reason);
    });

    it("replay: the stored result, checked against result v1 or v2", async () => {
        fetchMock.mockResolvedValue(jsonResponse(result, 200));
        const id = String((result as { result_id: string }).result_id);
        await expect(transport().readResult(id, signal)).resolves.toEqual(result);
        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toBe(`${ISSUER}/api/v1/context-fabric/investigations/${id}`);
    });

    it("status and replay: a 401 is resent once with a new token; never a second time, never with the same token (CHAOS-12305)", async () => {
        const id = String((result as { result_id: string }).result_id);
        const reads = [
            (t: Calls) => t.submissionStatus(SUBMISSION, signal),
            (t: Calls) => t.readResult(id, signal),
        ];
        const answers = [statusBody, result];
        for (const [index, read] of reads.entries()) {
            // A new token: resent once, and its answer is the call's.
            fetchMock.mockReset();
            rejected.mockReset();
            fetchMock
                .mockResolvedValueOnce(unauthorized())
                .mockResolvedValueOnce(jsonResponse(answers[index], 200));
            await expect(read(withStore(held(TOKEN), held(NEXT)).t)).resolves.toEqual(
                answers[index],
            );
            expect(sent().map((s) => s.headers.Authorization)).toEqual([
                `Bearer ${TOKEN}`,
                `Bearer ${NEXT}`,
            ]);
            expect(sent()[1]!.url).toBe(sent()[0]!.url);
            expect(rejected.mock.calls).toEqual([[TOKEN]]);
            // A second 401: authorization_required after exactly 2 requests.
            fetchMock.mockReset();
            rejected.mockReset();
            fetchMock.mockImplementation(async () => unauthorized());
            await expect(read(withStore(held(TOKEN), held(NEXT)).t)).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(rejected.mock.calls).toEqual([[TOKEN], [NEXT]]);
            // The same token read again: not resent.
            fetchMock.mockReset();
            fetchMock.mockImplementation(async () => unauthorized());
            await expect(read(withStore(held(TOKEN), held(TOKEN)).t)).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it("replay: 404 is a TransportRefusal 404; a broken body is invalid_upstream", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
        await expect(transport().readResult("result_x", signal)).rejects.toMatchObject({
            status: 404,
        });
        fetchMock.mockResolvedValueOnce(jsonResponse({ status: "complete" }, 200));
        await expect(transport().readResult("result_x", signal)).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
        // A body the views could read, but that the result checks refuse, is refused too. ask-dev
        // stubs the checks: the schema's own cases are web's.
        fetchMock.mockResolvedValueOnce(jsonResponse(result, 200));
        const refusing = transportChecking(
            streamEnvelopeValidators,
            validators.rejecting(
                validators.rejecting(streamValidators, "validateInvestigationResultV1"),
                "validateInvestigationResultV2",
            ),
        );
        await expect(refusing.readResult("result_x", signal)).rejects.toEqual(
            new TransportFailure("invalid_upstream"),
        );
    });
});

describe("logs: a 401 (CHAOS-12369)", () => {
    const RESENT = "ask-dev acr call 401 resent";
    const resends = () =>
        [...log.info.mock.calls, ...log.warn.mock.calls].filter(
            ([, message]) => message === "ask-dev acr call 401",
        );
    const resent = () => log.info.mock.calls.filter(([, message]) => message === RESENT);

    it("a new token: one info line reread new, one resent line, and no warn when the resend works", async () => {
        const body = sseBody();
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(sseResponse(body.stream));
        body.push(stream(...CAPTURED));
        const { t } = withStore(held(TOKEN), held(NEXT));
        await collect(t.investigate(call()));
        expect(log.info.mock.calls.filter(([, m]) => m === "ask-dev acr call 401")).toEqual([
            [{ operation: "investigate", reread: "new" }, "ask-dev acr call 401"],
        ]);
        expect(resent()).toEqual([[{ operation: "investigate" }, RESENT]]);
        expect(log.warn.mock.calls.filter(([, m]) => m === "ask-dev acr call 401")).toEqual([]);
    });

    // Codex r3 on #1681: the re-read's result is not a resend. Only a sent request logs "resent".
    it("a spent budget after the re-read: reread new, no resent line, 1 request", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const { t } = withStore(held(TOKEN), () => {
            now = T0 + 105_001;
            return held(NEXT);
        });
        await expect(collect(t.investigate(call()))).rejects.toEqual(
            new TransportFailure("budget_exhausted"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(resends()).toEqual([
            [{ operation: "investigate", reread: "new" }, "ask-dev acr call 401"],
        ]);
        expect(resent()).toEqual([]);
    });

    it("an abort during the re-read: reread new, no resent line, 1 request (stream and JSON)", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const reason = new DOMException("deadline", "AbortError");
        const stream = new AbortController();
        const streamStore = withStore(held(TOKEN), () => {
            stream.abort(reason);
            return held(NEXT);
        });
        await expect(collect(streamStore.t.investigate(call(stream.signal)))).rejects.toBe(reason);
        const json = new AbortController();
        const jsonStore = withStore(held(TOKEN), () => {
            json.abort(reason);
            return held(NEXT);
        });
        await expect(jsonStore.t.submissionStatus(SUBMISSION, json.signal)).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(resends().map(([fields]) => fields)).toEqual([
            { operation: "investigate", reread: "new" },
            { operation: "status", reread: "new" },
        ]);
        expect(resent()).toEqual([]);
    });

    it("a second 401 after the resend: reread new, resent, then a warn second", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const { t } = withStore(held(TOKEN), held(NEXT));
        await collect(t.investigate(call())).catch(() => undefined);
        expect(resends()).toEqual([
            [{ operation: "investigate", reread: "new" }, "ask-dev acr call 401"],
            [{ operation: "investigate", second: true }, "ask-dev acr call 401"],
        ]);
        expect(resent()).toHaveLength(1);
        expect(log.warn.mock.calls.filter(([, m]) => m === "ask-dev acr call 401")).toEqual([
            [{ operation: "investigate", second: true }, "ask-dev acr call 401"],
        ]);
    });

    it.each<[string, AcrAccessToken]>([
        ["same", held(TOKEN)],
        ["none", { kind: "authorization_required" }],
    ])("the re-read gives %s: one warn line, no resend", async (read, again) => {
        fetchMock.mockImplementation(async () => unauthorized());
        const { t } = withStore(held(TOKEN), again);
        await collect(t.investigate(call())).catch(() => undefined);
        expect(resends()).toEqual([
            [{ operation: "investigate", reread: read }, "ask-dev acr call 401"],
        ]);
        expect(resent()).toEqual([]);
        expect(log.warn.mock.calls.filter(([, m]) => m === "ask-dev acr call 401")).toHaveLength(1);
    });

    it("the status and replay calls log their own operation name", async () => {
        const id = "result_x";
        const signal = new AbortController().signal;
        fetchMock.mockImplementation(async () => unauthorized());
        await withStore(held(TOKEN), held(NEXT))
            .t.submissionStatus(SUBMISSION, signal)
            .catch(() => undefined);
        await withStore(held(TOKEN), held(TOKEN))
            .t.readResult(id, signal)
            .catch(() => undefined);
        expect(resends().map(([fields]) => fields)).toEqual([
            { operation: "status", reread: "new" },
            { operation: "status", second: true },
            { operation: "replay", reread: "same" },
        ]);
        // Only the status call sent a second request.
        expect(resent().map(([fields]) => fields)).toEqual([{ operation: "status" }]);
    });

    it("a 401 line carries no token and no URL", async () => {
        fetchMock.mockImplementation(async () => unauthorized());
        const { t } = withStore(held(TOKEN), held(NEXT));
        await collect(t.investigate(call())).catch(() => undefined);
        const text = JSON.stringify(resends());
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(NEXT);
        expect(text).not.toContain(ISSUER);
    });

    it("no 401 line when the call is not refused", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(...CAPTURED));
        await collect(withStore(held(TOKEN)).t.investigate(call()));
        expect(resends()).toEqual([]);
    });
});

describe("logs", () => {
    it("never carry the token, the question or a URL", async () => {
        const body = sseBody();
        fetchMock.mockResolvedValue(sseResponse(body.stream));
        body.push(stream(accepted(), stageEvent(3, "interpreting", "started", 5)));
        await collect(transport().investigate(call())).catch(() => undefined);
        fetchMock.mockResolvedValue(jsonResponse(errorEnvelope("unauthorized", 401), 401));
        await collect(transport().investigate(call())).catch(() => undefined);
        const text = JSON.stringify(Object.values(log).flatMap((level) => level.mock.calls));
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain("Which projects");
        expect(text).not.toContain(ISSUER);
    });
});
