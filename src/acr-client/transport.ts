import type { ACRErrorV1 } from "../contracts/generated/error";

import type { AcrAccessToken, AcrSilentOutcome } from "./auth";
import type { AcrBrowserClientConfig } from "./config";
import {
    ACR_MIN_WAIT_BUDGET_SECONDS,
    HEADER_WAIT_MAX_MS,
    STALL_MS,
    WAIT_BUDGET_HEADROOM_MS,
} from "./deadline";
import { InvestigationEventGate } from "./eventGate";
import { ACR_CLIENT_VERSION, MAX_BODY_BYTES, MAX_EVENT_BYTES, MAX_STREAM_BYTES } from "./limits";
import { logger } from "./logger";
import { SseEventTooLargeError, SseMalformedError, SseParser } from "./sseParser";
import {
    TransportFailure,
    TransportRefusal,
    type CancelAnswer,
    type InvestigateCall,
    type InvestigationEvent,
    type TransportFailureReason,
} from "./types";

/**
 * The browser's ACR transport (CHAOS-12104, T14a; CHAOS-12336, T14b; design amendment §2.2, §4, §5,
 * §6, §7, §8; plan §2.7.5 to §2.7.7). The browser calls acr-api directly; there is no web route.
 *
 * - **Calls:** `investigate` (the event stream), `submissionStatus` and `readResult` (the replay)
 *   (T14a); `attach` and `cancel` (T14b). A host builds its other reads on `callJson`, `callUrl` and
 *   `refuse`, each mapping every status ACR's OpenAPI names for its route. Every call is a `fetch` with `credentials: "omit"` and `redirect: "error"`. Its headers are
 *   `Authorization: Bearer` with the in-memory access token, `X-ACR-Resource` (ACR's issuer, the
 *   only resource the browser class binds) and `X-ACR-Client-Version`. No token ever goes in a
 *   URL.
 * - **Attach:** `GET …/submissions/{id}/events` with exactly `Accept: text/event-stream` and
 *   `Last-Event-ID` (a safe integer) when the store has a cursor. It is read as the create stream
 *   is; after a cursor the gate resumes mid-run (`GateResume` in `eventGate.ts`).
 * - **Token:** read right before each call, from the token store's memory only
 *   (`getAcrAccessToken`). The `sessionStorage` family is never read here.
 * - **The silent step (CHAOS-12474):** with no token, a user act runs `authorize` once, here and
 *   nowhere else. The acts are `investigate`, `listThreads` (a History read, which the render asks
 *   for only while the list is on screen), `readEvidence`, and `readThread` when the store says
 *   the user opened it. Any other call is background: no token is
 *   `TransportFailure("authorization_required")`, and nothing goes out. So a panel open sends 0
 *   requests (P1-6).
 * - **401 (CHAOS-12305):** ACR refused the token, on any call. The transport tells the store
 *   (`reportAcrTokenRejected`), which drops it if it is still held, and reads the token once
 *   more; the store then refreshes. With no other token, it makes one silent attempt. A different
 *   token sends the call once more (the same `X-ACR-Submission-ID`, so a retried `investigate` is
 *   idempotent). A failed attempt is its own failure; the same token, or a second 401, is
 *   "authorization required". There is no loop: at most 2 requests and 1 attempt per call. Every
 *   call keeps the rule: the JSON calls in `callUrl`, the two streams in `readStream`
 *   (CHAOS-12336).
 * - **Deadline:** the store's absolute deadline D. The budget header is floor(D − now − 5 s) when
 *   the call is sent; below ACR's minimum the call is not sent (`budget_exhausted`). The response
 *   headers have min(15 s, D − now) (`admission_timeout`). Once they arrive, 30 s with no byte is
 *   `stalled`. The store aborts at D through the signal.
 * - **Stream:** the SSE parser (ported from #1608), at most `MAX_EVENT_BYTES` per event and
 *   `MAX_STREAM_BYTES` in all, then the event gate (`eventGate.ts`). Any break before a valid
 *   terminal is `invalid_upstream`. A later event in the same read is dropped and logged, and the
 *   stream closes. The end of the stream with no terminal returns: the store recovers the run
 *   through the submission status.
 * - **Validators** (the host's; the lead's option (c)): every event is checked at once against the
 *   event envelope. The full schemas (the event with its whole result, and result v1/v2) start
 *   loading at the submit or the replay, in parallel with the call. Only the `result` terminal and
 *   the replay wait for them. Nothing is loaded on panel open.
 * - **Logs:** content-free (submission id, status, closed reason codes, counts). Never a token, a
 *   question, an answer or a URL.
 */

/** The small checks, loaded with the transport. */
export type StreamEnvelopeValidators = {
    readonly validateInvestigationEventEnvelope: (value: unknown) => boolean;
    readonly validateSubmissionStatus: (value: unknown) => boolean;
    readonly validateErrorEnvelope: (value: unknown) => boolean;
};

/** The full checks, loaded from the first call on. */
export type StreamValidators = {
    readonly validateInvestigationEvent: (value: unknown) => boolean;
    readonly validateInvestigationResultV1: (value: unknown) => boolean;
    readonly validateInvestigationResultV2: (value: unknown) => boolean;
};

export type AcrCallDependencies<TResult> = {
    readonly fetch: typeof fetch;
    readonly now: () => number;
    /** The token store's access token, read right before each call (`getAcrAccessToken`). */
    readonly token: () => AcrAccessToken | Promise<AcrAccessToken>;
    /** ACR answered 401 for `token`: the store drops it if it is still held (CHAOS-12305). */
    readonly rejected: (token: string) => void;
    /** The silent step (`authorizeAcrSilently`): only at a user act or after a 401. */
    readonly authorize: () => Promise<AcrSilentOutcome>;
    readonly envelope: StreamEnvelopeValidators;
    /** Starts (or joins) the load of the full checks. */
    readonly validators: () => Promise<StreamValidators>;
    /**
     * Whether the host's views can read a result the checks passed. A check, not a mapping: the
     * full event check reads the wire value, and every call returns that value.
     */
    readonly isResult: (value: unknown) => value is TResult;
};

/** The calls of the client, and the helpers a host builds its other reads on. */
export type AcrCalls<TResult, TStatus> = {
    readonly investigate: (call: InvestigateCall) => AsyncGenerator<InvestigationEvent<TResult>>;
    readonly attach: (call: {
        readonly submissionId: string;
        readonly lastEventId?: number | undefined;
        readonly signal: AbortSignal;
    }) => AsyncGenerator<InvestigationEvent<TResult>>;
    readonly submissionStatus: (
        submissionId: string,
        signal: AbortSignal,
    ) => Promise<TStatus | null>;
    readonly readResult: (resultId: string, signal: AbortSignal) => Promise<TResult>;
    readonly cancel: (call: {
        readonly submissionId: string;
        readonly signal: AbortSignal;
    }) => Promise<CancelAnswer>;
    readonly callJson: (
        path: string,
        operation: string,
        signal: AbortSignal,
        method?: "GET" | "POST" | "DELETE",
        json?: unknown,
        moment?: AcrCallMoment,
    ) => Promise<AcrCallAnswer>;
    readonly callUrl: (
        url: string,
        operation: string,
        signal: AbortSignal,
        method?: "GET" | "POST" | "DELETE",
        json?: unknown,
        moment?: AcrCallMoment,
    ) => Promise<AcrCallAnswer>;
    readonly refuse: (response: Response, operation: string, signal: AbortSignal) => Promise<never>;
};

/** One JSON call's answer: its body is read only when it is 2xx. */
export type AcrCallAnswer = { readonly response: Response; readonly body: unknown };

/** Whether a call may run the silent step when it has no token (CHAOS-12474). */
export type AcrCallMoment = "user_act" | "background";

/** What a silent step that gave no token means to the store. */
const SILENT_FAILURE: Readonly<
    Record<Exclude<AcrSilentOutcome["kind"], "token">, TransportFailureReason>
> = {
    off: "authorization_required",
    session_ended: "session_ended",
    impersonating: "impersonating",
    not_entitled: "not_entitled",
    rate_limited: "authorization_limited",
    failed: "authorization_failed",
};

const API = "/api/v1/context-fabric";

/** A query value as ACR reads it: `encodeURIComponent` (a space is `%20`, never `+`). */
export const acrQuery = (pairs: Record<string, string | undefined>): string => {
    const parts = Object.entries(pairs)
        .filter((pair): pair is [string, string] => pair[1] !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
    return parts.length === 0 ? "" : `?${parts.join("&")}`;
};

/**
 * The operations whose route has no 404 in ACR's OpenAPI (CHAOS-12336, codex r2 on #1677): a 404
 * with no `error.v1` body there is not ACR's not-found answer but a dropped call.
 */
const NO_404_OPERATIONS: ReadonlySet<string> = new Set(["threads_list"]);

/** ACR's 409 `submission_in_progress` with `details.reason: not_leased` (the cancel route). */
function isNotLeased(body: ACRErrorV1): boolean {
    const details = (body.error as { details?: { reason?: unknown } }).details;
    return body.error.code === "submission_in_progress" && details?.reason === "not_leased";
}

/** ACR's `Retry-After` in whole seconds, when it is one. */
function retryAfterOf(response: Response): number | undefined {
    const raw = response.headers.get("Retry-After");
    // Up to 8 digits: ACR's monthly allowance answers up to a month ahead (CHAOS-12564).
    if (raw === null || !/^\d{1,8}$/u.test(raw.trim())) return undefined;
    return Number(raw.trim());
}

/**
 * Reads a JSON body of at most `MAX_BODY_BYTES`; `undefined` when it is larger or not JSON. An end
 * of `signal` cancels the read and throws the signal's reason: a body that stalls never outlives
 * its call (codex r3).
 */
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw signal.reason;
    const body = response.body;
    if (body === null) return undefined;
    const reader = body.getReader();
    const stop = () => void reader.cancel(signal.reason).catch(() => undefined);
    signal.addEventListener("abort", stop, { once: true });
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            // A canceled read reads as done: the abort decides what that means.
            if (signal.aborted) throw signal.reason;
            if (done) break;
            size += value.length;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel().catch(() => undefined);
                return undefined;
            }
            parts.push(value);
        }
    } catch {
        // A body fetch errors on abort reads as the abort, not as a broken body.
        if (signal.aborted) throw signal.reason;
        return undefined;
    } finally {
        signal.removeEventListener("abort", stop);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
    } catch {
        return undefined;
    }
}

/** An `error.v1` envelope for a status with no valid body (a 404 replay, for example). */
function syntheticError(status: number, code: string): ACRErrorV1 {
    return {
        schema_version: "error.v1",
        request_id: "browser_transport",
        error: {
            code,
            message: "ACR answered with no error body.",
            http_status: status,
            retryable: false,
        },
    } as ACRErrorV1;
}

export function createAcrCalls<TResult, TStatus>(
    config: AcrBrowserClientConfig,
    dependencies: AcrCallDependencies<TResult>,
): AcrCalls<TResult, TStatus> {
    const base = `${config.issuer}${API}`;

    /**
     * Starts (or joins) the load of the full checks. Its failure is seen where it is awaited; it is
     * never an unhandled rejection, since a run may end before it needs the checks.
     */
    function startFullChecks(): Promise<StreamValidators> {
        const loading = dependencies.validators();
        loading.catch(() => undefined);
        return loading;
    }

    /** The silent step's token, or the failure that names why there is none. */
    function tokenOf(outcome: AcrSilentOutcome): string {
        if (outcome.kind === "token") return outcome.token;
        throw new TransportFailure(SILENT_FAILURE[outcome.kind]);
    }

    /**
     * The in-memory token, read right before a call. With none, a user act runs the silent step
     * once; a background call has "authorization required", and sends nothing.
     */
    async function bearer(moment: AcrCallMoment): Promise<string> {
        const held = await dependencies.token();
        if (held.kind === "token") return held.token;
        if (held.kind === "off" || moment === "background") {
            throw new TransportFailure("authorization_required");
        }
        return tokenOf(await dependencies.authorize());
    }

    /**
     * ACR answered 401 for `token` (CHAOS-12305). Tells the store, then reads the token once more.
     * With no other token, one silent attempt (CHAOS-12474). A different token is the one retry.
     * The same token is null ("authorization required"); a failed attempt throws its own failure.
     */
    async function another(token: string, operation: string): Promise<string | null> {
        dependencies.rejected(token);
        const next = await dependencies.token();
        // CHAOS-12369: one line per 401, no token value. It says what the re-read gave, not that a
        // resend followed: an abort or a spent budget can still stop it (codex r3 on #1681).
        if (next.kind === "token" && next.token !== token) {
            logger.info({ operation, reread: "new" }, "ask-dev acr call 401");
            return next.token;
        }
        const read = next.kind === "token" ? "same" : "none";
        logger.warn({ operation, reread: read }, "ask-dev acr call 401");
        const silent = tokenOf(await dependencies.authorize());
        return silent === token ? null : silent;
    }

    const headers = (token: string, extra: Record<string, string>): Record<string, string> => ({
        Authorization: `Bearer ${token}`,
        "X-ACR-Resource": config.issuer,
        "X-ACR-Client-Version": ACR_CLIENT_VERSION,
        ...extra,
    });

    /**
     * What a non-2xx answer means, its body already read: 401 is "authorization required"; an
     * `error.v1` body is a `TransportRefusal`; anything else is a dropped call (the store recovers
     * it).
     */
    function refusal(response: Response, body: unknown, operation: string): Error {
        logger.info({ operation, status: response.status }, "ask-dev acr call refused");
        if (response.status === 401) return new TransportFailure("authorization_required");
        if (body !== undefined && dependencies.envelope.validateErrorEnvelope(body)) {
            return new TransportRefusal(
                response.status,
                body as ACRErrorV1,
                retryAfterOf(response),
            );
        }
        // A body-less 404 is ACR's "not found" only on a route whose contract has one.
        if (response.status === 404 && !NO_404_OPERATIONS.has(operation)) {
            return new TransportRefusal(404, syntheticError(404, "not_found"));
        }
        return new Error(`ask-dev acr ${operation}: ${String(response.status)} with no error body`);
    }

    /** Throws what a non-2xx answer means (`refusal`), reading its body first. */
    async function refuse(
        response: Response,
        operation: string,
        signal: AbortSignal,
    ): Promise<never> {
        const body = response.status === 401 ? undefined : await boundedJson(response, signal);
        throw refusal(response, body, operation);
    }

    /** One JSON call on ACR's Context Fabric API (`callUrl`). */
    const callJson = (
        path: string,
        operation: string,
        signal: AbortSignal,
        method: "GET" | "POST" | "DELETE" = "GET",
        json?: unknown,
        moment: AcrCallMoment = "background",
    ) => callUrl(`${base}${path}`, operation, signal, method, json, moment);

    /**
     * One JSON call with the 15 s header bound: a GET by default, or `method` with an optional JSON
     * `body`. A 401 is sent once more with a different token (CHAOS-12305). The answer's body is
     * read only when it is 2xx; a non-2xx answer is for `refuse`.
     */
    async function callUrl(
        url: string,
        operation: string,
        signal: AbortSignal,
        method: "GET" | "POST" | "DELETE" = "GET",
        json?: unknown,
        moment: AcrCallMoment = "background",
    ): Promise<{ readonly response: Response; readonly body: unknown }> {
        if (signal.aborted) throw signal.reason;
        const token = await bearer(moment);
        let response = await sendJson(url, operation, signal, token, method, json);
        if (response.status === 401) {
            void response.body?.cancel().catch(() => undefined);
            const next = await another(token, operation);
            if (next !== null) {
                if (signal.aborted) throw signal.reason;
                logger.info({ operation }, "ask-dev acr call 401 resent");
                response = await sendJson(url, operation, signal, next, method, json);
                if (response.status === 401) {
                    logger.warn({ operation, second: true }, "ask-dev acr call 401");
                    dependencies.rejected(next);
                }
            }
        }
        if (!response.ok) return { response, body: undefined };
        return { response, body: await boundedJson(response, signal) };
    }

    /** One JSON request, to its response headers, with the 15 s bound. */
    async function sendJson(
        url: string,
        operation: string,
        signal: AbortSignal,
        token: string,
        method: "GET" | "POST" | "DELETE",
        json: unknown,
    ): Promise<Response> {
        // The signal may end while the token store answers: then nothing is sent.
        if (signal.aborted) throw signal.reason;
        const controller = new AbortController();
        const stop = () => controller.abort(signal.reason);
        signal.addEventListener("abort", stop, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, HEADER_WAIT_MAX_MS);
        try {
            const response = await dependencies.fetch(url, {
                method,
                headers: headers(
                    token,
                    json === undefined
                        ? { Accept: "application/json" }
                        : { Accept: "application/json", "Content-Type": "application/json" },
                ),
                ...(json === undefined ? {} : { body: JSON.stringify(json) }),
                credentials: "omit",
                redirect: "error",
                cache: "no-store",
                signal: controller.signal,
            });
            clearTimeout(timer);
            return response;
        } catch (error) {
            if (timedOut) throw new Error(`ask-dev acr ${operation}: no answer in time`);
            throw error;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", stop);
        }
    }

    async function* investigate(
        call: InvestigateCall,
    ): AsyncGenerator<InvestigationEvent<TResult>> {
        const budgetNow = () =>
            Math.floor((call.deadline - dependencies.now() - WAIT_BUDGET_HEADROOM_MS) / 1_000);
        if (budgetNow() < ACR_MIN_WAIT_BUDGET_SECONDS) {
            throw new TransportFailure("budget_exhausted");
        }
        // A question is the first of the user's acts (CHAOS-12474).
        const token = await bearer("user_act");
        // Option (c): the full checks start loading now, in parallel with the call; only the
        // `result` terminal waits for them.
        const full = startFullChecks();
        // The header is computed when the call is sent, from what is left of D (plan §2.7.6).
        let budget = budgetNow();
        if (budget < ACR_MIN_WAIT_BUDGET_SECONDS) throw new TransportFailure("budget_exhausted");

        yield* readStream({
            path: "/investigations",
            method: "POST",
            token,
            headers: () => ({
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "X-ACR-Submission-ID": call.submissionId,
                "X-ACR-Thread-ID": call.threadId,
                "X-ACR-Wait-Budget-Seconds": String(budget),
            }),
            // CHAOS-12305: a resend after a 401 has its budget computed again; below ACR's minimum
            // nothing is sent.
            beforeResend: () => {
                budget = budgetNow();
                if (budget < ACR_MIN_WAIT_BUDGET_SECONDS) {
                    throw new TransportFailure("budget_exhausted");
                }
            },
            body: JSON.stringify(call.request),
            signal: call.signal,
            submissionId: call.submissionId,
            operation: "investigate",
            full,
            gate: () =>
                new InvestigationEventGate(
                    dependencies.envelope.validateInvestigationEventEnvelope,
                    dependencies.isResult,
                    call,
                ),
        });
    }

    /**
     * An attach (CHAOS-12336): `GET …/submissions/{id}/events` with exactly `Accept:
     * text/event-stream`, and `Last-Event-ID` when the store has a cursor. It reads the stream as a
     * create does (the reader, the caps, the 15 s header wait, the 30 s stall, the checks); the gate
     * resumes after the cursor (`GateResume`).
     */
    async function* attach(call: {
        readonly submissionId: string;
        readonly lastEventId?: number | undefined;
        readonly signal: AbortSignal;
    }): AsyncGenerator<InvestigationEvent<TResult>> {
        const cursor = call.lastEventId;
        if (cursor !== undefined && !(Number.isSafeInteger(cursor) && cursor >= 0)) {
            throw new TypeError(
                "ask-dev acr attach: Last-Event-ID must be a safe integer of 0 or more",
            );
        }
        if (call.signal.aborted) throw call.signal.reason;
        const token = await bearer("background");
        // Option (c): the full checks load in parallel; only a `result` waits for them.
        const full = startFullChecks();
        yield* readStream({
            path: `/investigations/submissions/${encodeURIComponent(call.submissionId)}/events`,
            method: "GET",
            token,
            headers: () => ({
                Accept: "text/event-stream",
                ...(cursor === undefined ? {} : { "Last-Event-ID": String(cursor) }),
            }),
            signal: call.signal,
            submissionId: call.submissionId,
            operation: "attach",
            full,
            gate: () =>
                new InvestigationEventGate(
                    dependencies.envelope.validateInvestigationEventEnvelope,
                    dependencies.isResult,
                    { submissionId: call.submissionId },
                    { resumeAfter: cursor },
                ),
        });
    }

    /**
     * Opens one event stream and reads it (T14a): the header wait, the stall rule, the caps, the
     * framing, the gate, the full check of a `result`, and the close after the terminal. Every halt
     * cancels the body reader too.
     */
    async function* readStream(spec: {
        readonly path: string;
        readonly method: "GET" | "POST";
        readonly token: string;
        /** The headers past the three every call carries, computed at each send. */
        readonly headers: () => Record<string, string>;
        /** Runs before the one resend after a 401 (CHAOS-12305); it may throw to send nothing. */
        readonly beforeResend?: () => void;
        readonly body?: string;
        readonly signal: AbortSignal;
        readonly submissionId: string;
        readonly operation: string;
        readonly full: Promise<StreamValidators>;
        readonly gate: () => InvestigationEventGate<TResult>;
    }): AsyncGenerator<InvestigationEvent<TResult>> {
        const controller = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        // Ending a call cancels its body reader too: a pending read never waits on the fetch's own
        // abort to give up.
        const halt = (reason?: unknown) => {
            controller.abort(reason);
            void reader?.cancel().catch(() => undefined);
        };
        const stop = () => halt(spec.signal.reason);
        if (spec.signal.aborted) throw spec.signal.reason;
        spec.signal.addEventListener("abort", stop, { once: true });
        let ended: "admission_timeout" | "stalled" | undefined;
        const end = (reason: "admission_timeout" | "stalled") => {
            ended = reason;
            halt();
        };
        /** What a read that ended (or failed) after a halt means. */
        const halted = (): unknown =>
            ended !== undefined
                ? new TransportFailure(ended)
                : spec.signal.aborted
                  ? spec.signal.reason
                  : undefined;
        // The header wait is 15 s. For a create, it is min(15 s, D − now) (plan §2.7.6), and a create
        // is sent only with D − now − 5 s at least ACR's 10 s minimum, so D − now is at least 15 s.
        let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
            () => end("admission_timeout"),
            HEADER_WAIT_MAX_MS,
        );
        try {
            let token = spec.token;
            const send = async (): Promise<Response> => {
                try {
                    return await dependencies.fetch(`${base}${spec.path}`, {
                        method: spec.method,
                        headers: headers(token, spec.headers()),
                        ...(spec.body === undefined ? {} : { body: spec.body }),
                        credentials: "omit",
                        redirect: "error",
                        cache: "no-store",
                        signal: controller.signal,
                    });
                } catch (error) {
                    throw halted() ?? error;
                }
            };
            let response = await send();
            clearTimeout(timer);
            if (response.status === 401) {
                // CHAOS-12305: one resend with a different token, the same submission id (a create
                // is idempotent on it); its header wait (and a create's budget) is computed again.
                void response.body?.cancel().catch(() => undefined);
                const next = await another(token, spec.operation);
                if (next !== null) {
                    if (spec.signal.aborted) throw spec.signal.reason;
                    spec.beforeResend?.();
                    token = next;
                    logger.info({ operation: spec.operation }, "ask-dev acr call 401 resent");
                    timer = setTimeout(() => end("admission_timeout"), HEADER_WAIT_MAX_MS);
                    response = await send();
                    clearTimeout(timer);
                    if (response.status === 401) {
                        logger.warn(
                            { operation: spec.operation, second: true },
                            "ask-dev acr call 401",
                        );
                        dependencies.rejected(token);
                    }
                }
            }
            if (!response.ok) await refuse(response, spec.operation, spec.signal);
            const type = response.headers.get("Content-Type") ?? "";
            if (!/^text\/event-stream\b/iu.test(type) || response.body === null) {
                logger.warn(
                    { submission_id: spec.submissionId },
                    "ask-dev acr stream answered with no event stream",
                );
                throw new TransportFailure("invalid_upstream");
            }
            reader = response.body.getReader();
            const parser = new SseParser(MAX_EVENT_BYTES);
            const gate = spec.gate();
            let total = 0;
            const arm = () => {
                clearTimeout(timer);
                timer = setTimeout(() => end("stalled"), STALL_MS);
            };
            arm();
            for (;;) {
                let chunk: ReadableStreamReadResult<Uint8Array>;
                try {
                    chunk = await reader.read();
                } catch (error) {
                    throw halted() ?? error;
                }
                // A canceled reader reads as done: the halt decides what that means.
                const why = halted();
                // eslint-disable-next-line @typescript-eslint/only-throw-error -- the signal's own reason.
                if (why !== undefined) throw why;
                if (chunk.done) {
                    const { discardedPartialEvent } = parser.end();
                    logger.warn(
                        {
                            submission_id: spec.submissionId,
                            last_seq: gate.lastSeq,
                            partial_event: discardedPartialEvent,
                        },
                        "ask-dev acr stream ended without a terminal",
                    );
                    return;
                }
                arm();
                total += chunk.value.length;
                if (total > MAX_STREAM_BYTES) {
                    logger.warn(
                        { submission_id: spec.submissionId, cap: "stream" },
                        "ask-dev acr stream over its cap",
                    );
                    throw new TransportFailure("invalid_upstream");
                }
                let frames;
                try {
                    frames = parser.push(chunk.value);
                } catch (error) {
                    const cap = error instanceof SseEventTooLargeError ? "event" : "framing";
                    if (!(
                        error instanceof SseEventTooLargeError || error instanceof SseMalformedError
                    )) {
                        throw error;
                    }
                    logger.warn(
                        { submission_id: spec.submissionId, cap },
                        "ask-dev acr stream broke its framing",
                    );
                    throw new TransportFailure("invalid_upstream");
                }
                for (const frame of frames) {
                    const verdict = gate.accept(frame);
                    if (verdict.kind === "invalid") {
                        logger.warn(
                            {
                                submission_id: spec.submissionId,
                                reason: verdict.reason,
                                seq: verdict.seq,
                            },
                            "ask-dev acr stream broke its grammar",
                        );
                        throw new TransportFailure("invalid_upstream");
                    }
                    if (verdict.kind === "after_terminal") {
                        logger.warn(
                            { submission_id: spec.submissionId, event_type: verdict.eventType },
                            "ask-dev acr event after the terminal dropped",
                        );
                        continue;
                    }
                    if (verdict.event.type === "result") {
                        const checks = await spec.full;
                        if (!checks.validateInvestigationEvent(verdict.event)) {
                            logger.warn(
                                {
                                    submission_id: spec.submissionId,
                                    reason: "schema",
                                    seq: verdict.event.seq,
                                },
                                "ask-dev acr stream broke its grammar",
                            );
                            throw new TransportFailure("invalid_upstream");
                        }
                    }
                    yield verdict.event;
                }
                // The terminal was passed on: the stream closes.
                if (gate.ended) return;
            }
        } finally {
            clearTimeout(timer);
            spec.signal.removeEventListener("abort", stop);
            controller.abort();
            await reader?.cancel().catch(() => undefined);
        }
    }

    return {
        investigate,
        attach,
        async submissionStatus(submissionId, signal) {
            const path = `/investigations/submissions/${encodeURIComponent(submissionId)}`;
            const { response, body } = await callJson(path, "status", signal);
            if (response.status === 404) return null;
            if (!response.ok) return refuse(response, "status", signal);
            if (body === undefined || !dependencies.envelope.validateSubmissionStatus(body)) {
                throw new TransportFailure("invalid_upstream");
            }
            return body as TStatus;
        },
        async readResult(resultId, signal) {
            const path = `/investigations/${encodeURIComponent(resultId)}`;
            // The full checks load in parallel with the replay.
            const full = startFullChecks();
            const { response, body } = await callJson(path, "replay", signal);
            if (!response.ok) return refuse(response, "replay", signal);
            const validators = await full;
            const valid =
                body !== undefined &&
                (validators.validateInvestigationResultV1(body) ||
                    validators.validateInvestigationResultV2(body));
            if (!valid || !dependencies.isResult(body)) {
                throw new TransportFailure("invalid_upstream");
            }
            return body;
        },
        async cancel({ submissionId, signal }): Promise<CancelAnswer> {
            const path = `/investigations/submissions/${encodeURIComponent(submissionId)}/cancel`;
            const { response } = await callJson(path, "cancel", signal, "POST");
            if (response.status === 202) return { kind: "running" };
            if (response.status === 204) return { kind: "final" };
            if (response.status === 409) {
                const body = await boundedJson(response, signal);
                if (
                    body !== undefined &&
                    dependencies.envelope.validateErrorEnvelope(body) &&
                    isNotLeased(body as ACRErrorV1)
                ) {
                    return { kind: "not_leased", retryAfterSeconds: retryAfterOf(response) };
                }
                throw refusal(response, body, "cancel");
            }
            if (!response.ok) return refuse(response, "cancel", signal);
            throw new TransportFailure("invalid_upstream");
        },
        callJson,
        callUrl,
        refuse,
    };
}
