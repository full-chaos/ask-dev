/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/require-await -- ported web test: its fakes return promises and read untyped JSON on purpose */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logger", () => ({ logger: log }));

import type { AcrAccessToken, AcrSilentOutcome } from "../auth";
import type { AcrBrowserClientConfig } from "../config";
import { createAcrCalls, type AcrCalls } from "../transport";
import { TransportFailure, TransportRefusal, type InvestigationEvent } from "../types";
import {
    acceptedEvent,
    acrFrame,
    isResult,
    CAPTURED_EVENTS,
    heartbeatEvent,
    validators,
    type TestResult,
    type TestStatus,
} from "./eventFixtures";

type Calls = AcrCalls<TestResult, TestStatus>;

/**
 * CHAOS-12336 (T14b): the attach and cancel calls of the browser's ACR transport, and the status
 * and replay calls on a 409, against a fake `fetch` with real `Response`s (the T14a fakes). The
 * host's other reads (threads, feedback, evidence) are tested where they are built.
 */

const ISSUER = "https://acr.example.test";
const API = `${ISSUER}/api/v1/context-fabric`;
const CONFIG: AcrBrowserClientConfig = {
    issuer: ISSUER,
    webOrigin: "https://web.example.test",
    clientId: "https://web.example.test/oauth/acr-client.json",
    redirectUri: "https://web.example.test/ask-dev/oauth/callback",
    usesMetadataDocument: true,
};
const TOKEN = "fcacr_test_token_0000000000000000000000000000000";
const SUBMISSION = "sub-12345678";

let token: AcrAccessToken;
let fetchMock: ReturnType<typeof vi.fn>;
/** What the transport told the token store ACR refused (CHAOS-12305). */
let rejected: ReturnType<typeof vi.fn<(token: string) => void>>;
/** What the silent step answers; off, so a test here sees "authorization required" (CHAOS-12474). */
const authorizeAnswer = (): AcrSilentOutcome => ({ kind: "off" });
const signal = new AbortController().signal;

function transport(): Calls {
    return createAcrCalls<TestResult, TestStatus>(CONFIG, {
        fetch: fetchMock as unknown as typeof fetch,
        now: () => 1_800_000_000_000,
        token: () => token,
        rejected: (refused: string) => rejected(refused),
        authorize: async () => authorizeAnswer(),
        envelope: validators.envelope,
        isResult,
        validators: async () => validators.full,
    });
}

const jsonResponse = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
const empty = (status: number) => new Response(null, { status });

const errorEnvelope = (
    code: string,
    status: number,
    details?: Record<string, unknown>,
): Record<string, unknown> => ({
    schema_version: "error.v1",
    request_id: "req_refused",
    error: {
        code,
        message: "refused",
        http_status: status,
        retryable: true,
        ...(details === undefined ? {} : { details }),
    },
});

/** The request of the n-th fetch. */
function sent(n = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
    return { url, init };
}

/** The rules every call keeps (AC): bearer, resource, client version, no cookie, no token in the URL. */
function expectAcrCall(n: number, method: string, url: string) {
    const { url: actual, init } = sent(n);
    expect(actual).toBe(url);
    expect(actual).not.toContain(TOKEN);
    expect(init).toMatchObject({
        method,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
    });
    expect(init.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        "X-ACR-Resource": ISSUER,
        "X-ACR-Client-Version": "0.1.0",
    });
}

beforeEach(() => {
    token = { kind: "token", token: TOKEN, issuer: ISSUER };
    fetchMock = vi.fn();
    rejected = vi.fn<(token: string) => void>();
    for (const level of Object.values(log)) level.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

type EventObject = Record<string, unknown> & { readonly seq: number; readonly type: string };
/** The captured run's submission: an attach with no cursor replays its `accepted`. */
const RUN = String(acceptedEvent().submission_id);
const CAPTURED = CAPTURED_EVENTS as EventObject[];
const frames = (events: readonly EventObject[]) => events.map(acrFrame).join("");
const sseResponse = (body: BodyInit) =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

async function collect(
    events: AsyncIterable<InvestigationEvent<TestResult>>,
): Promise<InvestigationEvent<TestResult>[]> {
    const out: InvestigationEvent<TestResult>[] = [];
    for await (const event of events) out.push(event);
    return out;
}

/** A body that stays open: push frames, never close. */
function openBody() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c;
        },
    });
    return { stream, push: (text: string) => controller.enqueue(new TextEncoder().encode(text)) };
}

describe("cancel", () => {
    const cancel = () => transport().cancel({ submissionId: SUBMISSION, signal });

    it("POST …/submissions/{id}/cancel with no body: 202 running, 204 final", async () => {
        fetchMock.mockResolvedValueOnce(empty(202));
        await expect(cancel()).resolves.toEqual({ kind: "running" });
        expectAcrCall(0, "POST", `${API}/investigations/submissions/${SUBMISSION}/cancel`);
        expect(sent(0).init.body ?? null).toBeNull();
        fetchMock.mockResolvedValueOnce(empty(204));
        await expect(cancel()).resolves.toEqual({ kind: "final" });
    });

    it("409 submission_in_progress with reason not_leased is not_leased, with Retry-After", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse(
                errorEnvelope("submission_in_progress", 409, { reason: "not_leased" }),
                409,
                { "Retry-After": "7" },
            ),
        );
        await expect(cancel()).resolves.toEqual({ kind: "not_leased", retryAfterSeconds: 7 });
        fetchMock.mockResolvedValueOnce(
            jsonResponse(
                errorEnvelope("submission_in_progress", 409, { reason: "not_leased" }),
                409,
            ),
        );
        await expect(cancel()).resolves.toEqual({
            kind: "not_leased",
            retryAfterSeconds: undefined,
        });
    });

    it("another 409, a 404 and a body-less 409 are refusals", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse(errorEnvelope("submission_in_progress", 409, { reason: "other" }), 409),
        );
        await expect(cancel()).rejects.toMatchObject({ name: "TransportRefusal", status: 409 });
        fetchMock.mockResolvedValueOnce(
            jsonResponse(errorEnvelope("submission_mismatch", 409), 409),
        );
        await expect(cancel()).rejects.toMatchObject({ name: "TransportRefusal", status: 409 });
        // The reason alone is not enough: the code must be submission_in_progress.
        fetchMock.mockResolvedValueOnce(
            jsonResponse(errorEnvelope("thread_closed", 409, { reason: "not_leased" }), 409),
        );
        await expect(cancel()).rejects.toMatchObject({ name: "TransportRefusal", status: 409 });
        fetchMock.mockResolvedValueOnce(jsonResponse(errorEnvelope("not_found", 404), 404));
        await expect(cancel()).rejects.toMatchObject({ name: "TransportRefusal", status: 404 });
        fetchMock.mockResolvedValueOnce(empty(409));
        await expect(cancel()).rejects.toThrow(/409/u);
    });

    it("a 200 is not in the contract: invalid_upstream", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
        await expect(cancel()).rejects.toEqual(new TransportFailure("invalid_upstream"));
    });
});

describe("attach", () => {
    const attach = (lastEventId?: number, t = transport()) =>
        t.attach({ submissionId: RUN, lastEventId, signal });

    it("GET …/events with exactly Accept: text/event-stream; no cursor replays from accepted", async () => {
        fetchMock.mockResolvedValueOnce(sseResponse(frames(CAPTURED)));
        const events = await collect(attach());
        expect(events.map((event) => event.seq)).toEqual(CAPTURED.map((event) => event.seq));
        expectAcrCall(0, "GET", `${API}/investigations/submissions/${RUN}/events`);
        const { init } = sent(0);
        expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
        expect(init.headers).not.toHaveProperty("Last-Event-ID");
    });

    it("a cursor is sent as Last-Event-ID, and the stream resumes after it", async () => {
        fetchMock.mockResolvedValueOnce(sseResponse(frames(CAPTURED.slice(3))));
        const events = await collect(attach(3));
        expect(events[0]?.seq).toBe(4);
        expect(events.at(-1)?.type).toBe("result");
        expect(sent(0).init.headers).toMatchObject({ "Last-Event-ID": "3" });
    });

    it("a cursor that is not a safe integer of 0 or more sends nothing", async () => {
        for (const bad of [1.5, -1, 2 ** 53, Number.NaN]) {
            await expect(collect(attach(bad)), String(bad)).rejects.toThrow(/Last-Event-ID/u);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("404 and 410 cursor_expired are refusals; a non-SSE answer is invalid_upstream", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(errorEnvelope("not_found", 404), 404));
        await expect(collect(attach(3))).rejects.toMatchObject({
            name: "TransportRefusal",
            status: 404,
        });
        fetchMock.mockResolvedValueOnce(
            jsonResponse(errorEnvelope("cursor_expired", 410, { reason: "expired" }), 410),
        );
        await expect(collect(attach(3))).rejects.toMatchObject({
            name: "TransportRefusal",
            status: 410,
            error: { error: { code: "cursor_expired" } },
        });
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
        await expect(collect(attach())).rejects.toEqual(new TransportFailure("invalid_upstream"));
    });

    it("a break of the stream after the cursor is invalid_upstream", async () => {
        // The cursor is 3: the next event must be 4.
        fetchMock.mockResolvedValueOnce(sseResponse(frames(CAPTURED.slice(4))));
        await expect(collect(attach(3))).rejects.toEqual(
            new TransportFailure("invalid_upstream", "seq_gap"),
        );
    });

    it("a result the full schema refuses is invalid_upstream (option (c))", async () => {
        fetchMock.mockResolvedValueOnce(sseResponse(frames(CAPTURED)));
        const strict = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => 1_800_000_000_000,
            token: () => token,
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: validators.envelope,
            isResult,
            validators: async () =>
                validators.rejecting(validators.full, "validateInvestigationEvent"),
        });
        await expect(collect(attach(undefined, strict))).rejects.toEqual(
            new TransportFailure("invalid_upstream", "schema", true),
        );
    });

    it("no headers in 15 s is admission_timeout; no byte for 30 s is stalled", async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementationOnce(
            (_url: string, init: RequestInit) =>
                new Promise((_ok, fail) =>
                    init.signal!.addEventListener("abort", () => fail(init.signal!.reason)),
                ),
        );
        const waiting = collect(attach(3)).then(
            () => "ended",
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(15_000);
        expect(await waiting).toEqual(new TransportFailure("admission_timeout"));

        const body = openBody();
        fetchMock.mockResolvedValueOnce(sseResponse(body.stream));
        const stalling = collect(attach(3)).then(
            () => "ended",
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(0);
        body.push(frames([heartbeatEvent(4, 40_000)]));
        await vi.advanceTimersByTimeAsync(29_999);
        body.push(": keepalive\n\n");
        await vi.advanceTimersByTimeAsync(29_999);
        let settled = false;
        void stalling.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await stalling).toEqual(new TransportFailure("stalled"));
    });
});

describe("every call here", () => {
    const calls: [string, (t: Calls, s: AbortSignal) => Promise<unknown>][] = [
        ["cancel", (t, s) => t.cancel({ submissionId: SUBMISSION, signal: s })],
        ["attach", (t, s) => collect(t.attach({ submissionId: RUN, lastEventId: 3, signal: s }))],
    ];

    it("no token: authorization_required, and nothing is sent", async () => {
        token = { kind: "authorization_required" };
        for (const [name, run] of calls) {
            await expect(run(transport(), signal), name).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("401, and the store gives the same token again: authorization_required, not resent", async () => {
        for (const [name, run] of calls) {
            fetchMock.mockResolvedValueOnce(jsonResponse(errorEnvelope("invalid_token", 401), 401));
            await expect(run(transport(), signal), name).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
        }
        expect(fetchMock).toHaveBeenCalledTimes(calls.length);
        expect(rejected.mock.calls).toEqual(calls.map(() => [TOKEN]));
    });

    // CHAOS-12305 (c4's rule, the lead's ruling: T14b carries it to its 7 calls): a 401 tells the
    // token store, reads the token once more, and resends once only with a different token.
    const NEXT = "fcacr_next_token_00000000000000000000000000000000".slice(0, TOKEN.length);
    const held = (value: string): AcrAccessToken => ({
        kind: "token",
        token: value,
        issuer: ISSUER,
    });
    const unauthorized = () => jsonResponse(errorEnvelope("invalid_token", 401), 401);
    /** What each call's route answers when it serves the call. */
    const served: Record<string, () => Response> = {
        cancel: () => empty(202),
        attach: () => sseResponse(frames(CAPTURED.slice(3))),
    };
    /** A transport whose token store answers `reads` in order (then "authorization required"). */
    function withStore(...reads: Array<AcrAccessToken | (() => AcrAccessToken)>) {
        return createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => 1_800_000_000_000,
            token: () => {
                const next = reads.shift();
                if (next === undefined) return { kind: "authorization_required" };
                return typeof next === "function" ? next() : next;
            },
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: validators.envelope,
            isResult,
            validators: async () => validators.full,
        });
    }
    const bearerOf = (n: number) =>
        ((fetchMock.mock.calls[n] as [string, RequestInit])[1].headers as Record<string, string>)
            .Authorization;

    it("a 401, then a new token: reported, read once more, and sent once more with it", async () => {
        for (const [name, run] of calls) {
            fetchMock.mockReset();
            rejected.mockReset();
            fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(served[name]!());
            await expect(
                run(withStore(held(TOKEN), held(NEXT)), signal),
                name,
            ).resolves.not.toThrow();
            expect(fetchMock, name).toHaveBeenCalledTimes(2);
            expect([bearerOf(0), bearerOf(1)], name).toEqual([`Bearer ${TOKEN}`, `Bearer ${NEXT}`]);
            expect(sent(1).url, name).toBe(sent(0).url);
            expect(rejected.mock.calls, name).toEqual([[TOKEN]]);
        }
    });

    it("a second 401: authorization_required, exactly 2 requests, both tokens reported", async () => {
        for (const [name, run] of calls) {
            fetchMock.mockReset();
            rejected.mockReset();
            fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());
            await expect(run(withStore(held(TOKEN), held(NEXT)), signal), name).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
            expect(fetchMock, name).toHaveBeenCalledTimes(2);
            expect(rejected.mock.calls, name).toEqual([[TOKEN], [NEXT]]);
        }
    });

    it("a 401 and no token to read: authorization_required, 1 request", async () => {
        for (const [name, run] of calls) {
            fetchMock.mockReset();
            fetchMock.mockResolvedValueOnce(unauthorized());
            await expect(run(withStore(held(TOKEN)), signal), name).rejects.toEqual(
                new TransportFailure("authorization_required"),
            );
            expect(fetchMock, name).toHaveBeenCalledTimes(1);
        }
    });

    it("the resend after a 401 has its own 15 s header wait (a stream)", async () => {
        vi.useFakeTimers();
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockImplementationOnce(
                (_url: string, init: RequestInit) =>
                    new Promise((_ok, fail) =>
                        init.signal!.addEventListener("abort", () => fail(init.signal!.reason)),
                    ),
            );
        const t = withStore(held(TOKEN), held(NEXT));
        const outcome = collect(t.attach({ submissionId: RUN, lastEventId: 3, signal })).then(
            () => "ended",
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(14_999);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(await outcome).toEqual(new TransportFailure("admission_timeout"));
    });

    it("an abort while the token is read again sends nothing more", async () => {
        const reason = new DOMException("gone", "AbortError");
        for (const [name, run] of calls) {
            fetchMock.mockReset();
            fetchMock.mockResolvedValueOnce(unauthorized());
            const controller = new AbortController();
            const t = withStore(held(TOKEN), () => {
                controller.abort(reason);
                return held(NEXT);
            });
            await expect(run(t, controller.signal), name).rejects.toBe(reason);
            expect(fetchMock, name).toHaveBeenCalledTimes(1);
        }
    });

    it("a non-2xx answer with no valid error.v1 body is a dropped call, as in T14a (codex r1)", async () => {
        // Not ACR's refusal (a gateway's page, a broken envelope): neither a TransportRefusal nor
        // invalid_upstream. The store reads it as a dropped call; for these calls that is the same
        // state as any failed read.
        const broken = { schema_version: "error.v1", request_id: "req_bad", error: { code: "x" } };
        for (const [name, run] of calls) {
            fetchMock.mockResolvedValueOnce(jsonResponse(broken, 400));
            const error = await run(transport(), signal).then(
                () => undefined,
                (thrown: unknown) => thrown,
            );
            expect(error, name).toBeInstanceOf(Error);
            expect((error as Error).name, name).toBe("Error");
            expect((error as Error).message, name).toMatch(/400 with no error body/u);
        }
    });

    it("an error.v1 answer ACR may give on any route (503) is a refusal, with Retry-After", async () => {
        for (const [name, run] of calls) {
            fetchMock.mockResolvedValueOnce(
                jsonResponse(errorEnvelope("upstream_unavailable", 503), 503, {
                    "Retry-After": "3",
                }),
            );
            await expect(run(transport(), signal), name).rejects.toMatchObject({
                name: "TransportRefusal",
                status: 503,
                retryAfterSeconds: 3,
            });
        }
    });

    it("an aborted call reads no token, sends nothing and ends with the abort", async () => {
        const reason = new DOMException("gone", "AbortError");
        const controller = new AbortController();
        controller.abort(reason);
        const tokenRead = vi.fn(() => token);
        const unread = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: fetchMock as unknown as typeof fetch,
            now: () => 1_800_000_000_000,
            token: tokenRead,
            rejected: (refused: string) => rejected(refused),
            authorize: async () => authorizeAnswer(),
            envelope: validators.envelope,
            isResult,
            validators: async () => validators.full,
        });
        for (const [name, run] of calls) {
            await expect(run(unread, controller.signal), name).rejects.toBe(reason);
        }
        expect(tokenRead).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logs never carry the token", async () => {
        for (const [, run] of calls) {
            fetchMock.mockResolvedValueOnce(
                jsonResponse(errorEnvelope("upstream_unavailable", 503), 503),
            );
            await run(transport(), signal).catch(() => undefined);
        }
        expect(JSON.stringify(Object.values(log).map((level) => level.mock.calls))).not.toContain(
            TOKEN,
        );
    });
});

/**
 * CHAOS-12439: every JSON call of the client carries ACR's `error.v1` as a `TransportRefusal`, on
 * a 409 `no_repository` too. The streams (`investigate`, `attach`) refuse the same way, above.
 */
describe("409 no_repository on the JSON calls", () => {
    let transport409: Calls;
    let fetched: number;

    beforeEach(() => {
        fetched = 0;
        const body = {
            schema_version: "error.v1",
            request_id: "req_refused",
            error: {
                code: "no_repository",
                message: "refused",
                http_status: 409,
                retryable: false,
            },
        };
        transport409 = createAcrCalls<TestResult, TestStatus>(CONFIG, {
            fetch: async () => {
                fetched += 1;
                return new Response(JSON.stringify(body), {
                    status: 409,
                    headers: { "Content-Type": "application/json" },
                });
            },
            now: () => 1_800_000_000_000,
            token: () => ({ kind: "token", token: TOKEN, issuer: ISSUER }),
            rejected: () => undefined,
            authorize: async () => ({ kind: "off" }),
            envelope: validators.envelope,
            isResult,
            validators: async () => validators.full,
        });
    });

    const jsonCalls: readonly (readonly [string, (t: Calls) => Promise<unknown>])[] = [
        ["submissionStatus", (t) => t.submissionStatus("sub-12345678", signal)],
        ["readResult", (t) => t.readResult("res-12345678", signal)],
        ["cancel", (t) => t.cancel({ submissionId: "sub-12345678", signal })],
    ];

    it.each(jsonCalls)(
        "%s: TransportRefusal(409) carrying error.v1 no_repository",
        async (_name, run) => {
            const failure = await run(transport409).then(
                () => undefined,
                (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(TransportRefusal);
            expect((failure as TransportRefusal).status).toBe(409);
            expect((failure as TransportRefusal).error.error.code).toBe("no_repository");
            expect(fetched).toBe(1);
        },
    );
});
