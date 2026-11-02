/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/require-await -- ported web test: its fakes return promises and read untyped JSON on purpose */
import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logger", () => ({ logger: log }));

import type { AcrAccessToken, AcrSilentOutcome } from "../auth";
import type { AcrBrowserClientConfig } from "../config";
import { createAcrCalls, type AcrCalls } from "../transport";
import { TransportFailure, type TransportFailureReason } from "../types";
import { asResult, validators, type TestResult, type TestStatus } from "./eventFixtures";

type Calls = AcrCalls<TestResult, TestStatus>;

/**
 * CHAOS-12474: where the silent step sits. The transport runs it at a user act with no token, and
 * once after a 401; no other call does, so a panel open and a background read send nothing (P1-6).
 * This file holds the five calls of the client; the host's other reads are its own to test.
 */

const ISSUER = "https://acr.example.test";
const CONFIG: AcrBrowserClientConfig = {
    issuer: ISSUER,
    webOrigin: "https://web.example.test",
    clientId: "https://web.example.test/oauth/acr-client.json",
    redirectUri: "https://web.example.test/ask-dev/oauth/callback",
    usesMetadataDocument: true,
};
const OLD = `fcacr_${"O".repeat(43)}`;
const NEW = `fcacr_${"N".repeat(43)}`;
const THREAD = "thread-12345678";
const RUN = "sub-12345678";
const RESULT = "res-12345678";
const NONE: AcrAccessToken = { kind: "authorization_required" };
const held = (token: string): AcrAccessToken => ({ kind: "token", token, issuer: ISSUER });
const silent: AcrSilentOutcome = { kind: "token", token: NEW, issuer: ISSUER };

const signal = new AbortController().signal;
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
const unauthorized = () => json({}, 401);

let fetchMock: ReturnType<typeof vi.fn>;
let authorize: ReturnType<typeof vi.fn<() => Promise<AcrSilentOutcome>>>;
let rejected: ReturnType<typeof vi.fn<(token: string) => void>>;
let reads: AcrAccessToken[];

const transport = (): Calls =>
    createAcrCalls<TestResult, TestStatus>(CONFIG, {
        fetch: fetchMock as unknown as typeof fetch,
        now: () => 1_800_000_000_000,
        token: () => reads.shift() ?? NONE,
        rejected: (token: string) => rejected(token),
        authorize,
        envelope: validators.envelope,
        asResult,
        validators: async () => validators.full,
    });

async function drain(events: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of events) void _;
}

const investigate = (t: Calls) =>
    drain(
        t.investigate({
            request: {} as never,
            submissionId: RUN,
            threadId: THREAD,
            requestId: "req-1",
            deadline: 1_800_000_000_000 + 300_000,
            signal,
        } as never),
    );

/** Every call a user's act makes: with no token, each runs the silent step. */
const ACTS: readonly [string, (t: Calls) => Promise<unknown>, () => Response][] = [
    ["investigate", investigate, () => new Response(null, { status: 200 })],
];

/** Every background call: with no token, none may run it, whatever opened the page or the panel. */
const BACKGROUND: readonly [string, (t: Calls) => Promise<unknown>][] = [
    ["submissionStatus", (t) => t.submissionStatus(RUN, signal)],
    ["readResult", (t) => t.readResult(RESULT, signal)],
    ["attach", (t) => drain(t.attach({ submissionId: RUN, signal }))],
    ["cancel", (t) => t.cancel({ submissionId: RUN, signal })],
];

const bearerOf = (n: number) =>
    ((fetchMock.mock.calls[n] as [string, RequestInit])[1].headers as Record<string, string>)
        .Authorization;

beforeEach(() => {
    fetchMock = vi.fn();
    authorize = vi.fn(async () => silent);
    rejected = vi.fn<(token: string) => void>();
    reads = [];
    for (const level of Object.values(log)) level.mockReset();
});

describe("a user's act with no token", () => {
    it.each(ACTS)("%s runs the silent step once, then sends with its token", async (_, run, ok) => {
        fetchMock.mockResolvedValueOnce(ok());
        await run(transport()).catch(() => undefined);
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bearerOf(0)).toBe(`Bearer ${NEW}`);
    });

    it.each(ACTS)("%s with a held token runs no silent step", async (_, run, ok) => {
        reads = [held(OLD)];
        fetchMock.mockResolvedValueOnce(ok());
        await run(transport()).catch(() => undefined);
        expect(authorize).not.toHaveBeenCalled();
        expect(bearerOf(0)).toBe(`Bearer ${OLD}`);
    });

    const FAILURES: readonly [AcrSilentOutcome, TransportFailureReason][] = [
        [{ kind: "failed", reason: "unavailable" }, "authorization_failed"],
        [{ kind: "rate_limited" }, "authorization_limited"],
        [{ kind: "not_entitled" }, "not_entitled"],
        [{ kind: "impersonating" }, "impersonating"],
        [{ kind: "session_ended" }, "session_ended"],
        [{ kind: "off" }, "authorization_required"],
    ];

    it.each(FAILURES)(
        "a silent step that ends %j is %s, and nothing goes to ACR",
        async (end, reason) => {
            authorize.mockResolvedValue(end);
            for (const [name, run] of ACTS) {
                await expect(run(transport()), name).rejects.toEqual(new TransportFailure(reason));
            }
            expect(fetchMock).not.toHaveBeenCalled();
            expect(authorize).toHaveBeenCalledTimes(ACTS.length);
        },
    );

    it("an ACR client that is off runs no silent step", async () => {
        reads = [{ kind: "off" }];
        await expect(investigate(transport())).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(authorize).not.toHaveBeenCalled();
    });
});

describe("a background read with no token (P1-6)", () => {
    it.each(BACKGROUND)("%s runs no silent step and sends nothing", async (_, run) => {
        await expect(run(transport())).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(authorize).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("a 401", () => {
    const EVERY: readonly [string, (t: Calls) => Promise<unknown>][] = [
        ...ACTS.map(([name, run]) => [name, run] as [string, typeof run]),
        ...BACKGROUND,
    ];

    it.each(EVERY)("%s: reported, one silent attempt, then one resend", async (_, run) => {
        reads = [held(OLD)];
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(new Response(null, { status: 404 }));
        await run(transport()).catch(() => undefined);
        expect(rejected.mock.calls).toEqual([[OLD]]);
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect([bearerOf(0), bearerOf(1)]).toEqual([`Bearer ${OLD}`, `Bearer ${NEW}`]);
    });

    it.each(EVERY)("%s: a second 401 ends it: never a loop", async (_, run) => {
        reads = [held(OLD)];
        fetchMock.mockImplementation(async () => unauthorized());
        await expect(run(transport())).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(rejected.mock.calls).toEqual([[OLD], [NEW]]);
    });

    it("a refreshed token needs no silent attempt", async () => {
        reads = [held(OLD), held(NEW)];
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        await investigate(transport()).catch(() => undefined);
        expect(authorize).not.toHaveBeenCalled();
        expect(bearerOf(1)).toBe(`Bearer ${NEW}`);
    });

    it("a failed attempt is its own failure, after 1 request", async () => {
        reads = [held(OLD)];
        authorize.mockResolvedValue({ kind: "rate_limited" });
        fetchMock.mockResolvedValueOnce(unauthorized());
        await expect(investigate(transport())).rejects.toEqual(
            new TransportFailure("authorization_limited"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("an attempt that gives the refused token back is not resent", async () => {
        reads = [held(OLD)];
        authorize.mockResolvedValue({ kind: "token", token: OLD, issuer: ISSUER });
        fetchMock.mockResolvedValueOnce(unauthorized());
        await expect(investigate(transport())).rejects.toEqual(
            new TransportFailure("authorization_required"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a question resent after a silent attempt keeps its submission id", async () => {
        reads = [held(OLD)];
        fetchMock
            .mockResolvedValueOnce(unauthorized())
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        await investigate(transport()).catch(() => undefined);
        const submission = (n: number) =>
            (
                (fetchMock.mock.calls[n] as [string, RequestInit])[1].headers as Record<
                    string,
                    string
                >
            )["X-ACR-Submission-ID"];
        expect(submission(0)).toBe(RUN);
        expect(submission(1)).toBe(RUN);
    });
});
