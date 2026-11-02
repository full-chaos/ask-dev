/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/require-await -- ported web test: its fakes return promises and read untyped JSON on purpose */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcrOAuthMock } from "./acrOAuthMock";
import * as defaultTab from "../auth";
import {
    ACR_AUTHORIZATION_TTL_MS,
    ACR_CLONE_CHECK_MS,
    ACR_OAUTH_REQUEST_TIMEOUT_MS,
    ACR_TAB_KEY,
    ACR_TABS_CHANNEL,
    ACR_TOKEN_FAMILY_KEY,
    type AcrHostRoutes,
    type AcrPrincipal,
    type AcrPrincipalRead,
    type AcrTabChannel,
    type AcrTabMessage,
    authorizeAcrSilently,
    discoverAcrAuthorizationServer,
    getAcrAccessToken,
    pkceChallenge,
    readAcrHeldFamily,
    reportAcrTokenRejected,
    setAcrAuthDependenciesForTest,
} from "../auth";
import {
    ACR_BROWSER_SCOPE,
    acrBrowserClientConfig as clientConfig,
    type AcrBrowserClientConfig,
} from "../config";

/**
 * CHAOS-12369: the logger, mocked. `sink` keeps every call of the whole file (the per-test `log`
 * counts are cleared; the sink is not), so the no-secret guard at the end sees them all.
 */
const sink = vi.hoisted(() => [] as { level: string; args: unknown[] }[]);
const log = vi.hoisted(() => {
    const level = (name: string) =>
        vi.fn((...args: unknown[]) => {
            sink.push({ level: name, args });
        });
    return {
        debug: level("debug"),
        info: level("info"),
        warn: level("warn"),
        error: level("error"),
    };
});
vi.mock("../logger", () => ({ logger: log }));

/** The host's session read behind the browser's `principal` seam (CHAOS-12305). */
const getSession = vi.hoisted(() => vi.fn());

/**
 * CHAOS-12303 (c2 of the T13 split), CHAOS-12474: the browser's ACR authorization flow and token
 * store. The shapes are acr-api's at the web pin bd92be5a:
 * - metadata: `internal/api/oauth_routes.go:61-110`;
 * - the token body: `oauth_routes.go:764-771`, where `refresh_token` appears only with the browser
 *   refresh grant;
 * - errors: `{error}` with 400.
 * The host's route is a fake here: its own test runs it for real against a stub of ACR.
 */

/** The host's same-origin routes, as the token store is given them. */
const ACR_AUTHORIZE_ROUTE = "/api/ask-dev/authorize";
const ROUTES: AcrHostRoutes = { authorize: ACR_AUTHORIZE_ROUTE, session: "/api/auth/session" };

const ISSUER = "https://acr.fullchaos.dev";
const WEB = "https://www.fullchaos.dev";
/** The two paths of the web host's client; they are the defaults of these tests. */
const PATHS = { callback: "/ask-dev/oauth/callback", metadata: "/oauth/acr-client.json" };
const acrBrowserClientConfig = (issuer: string, origin: string) =>
    clientConfig(issuer, origin, PATHS);
const CONFIG = acrBrowserClientConfig(ISSUER, WEB) as AcrBrowserClientConfig;
const ACCESS = `fcacr_${"A".repeat(43)}`;
const REFRESH = `acrrt_${"R".repeat(43)}`;
const CODE = "acr-code-of-this-test";
const TAB_ID = /^[A-Za-z0-9_-]{22}$/u;
/** The web session's principal the family and the token are bound to (CHAOS-12305). */
const USER: AcrPrincipal = { userId: "user-1", orgId: "org-1" };
/** A family entry a past page load of this tab stored (CHAOS-12305: v2, bound to USER). */
const STORED_FAMILY = {
    v: 2,
    familyId: "F".repeat(22),
    issuer: ISSUER,
    clientId: CONFIG.clientId,
    refreshToken: REFRESH,
    tokenEndpoint: `${ISSUER}/token`,
    revocationEndpoint: `${ISSUER}/revoke`,
    userId: USER.userId,
    orgId: USER.orgId,
};

const METADATA = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    revocation_endpoint: `${ISSUER}/revoke`,
};

/** Every secret value a test of this file saw, by kind (CHAOS-12369): no log call may carry one. */
const secretsByKind = {
    access: new Set<string>([ACCESS]),
    refresh: new Set<string>([REFRESH]),
    code: new Set<string>(),
    verifier: new Set<string>(),
    state: new Set<string>(),
    tab: new Set<string>(),
};
/** Every storage made in the running test, to read its tab id at the end. */
let storages: MemoryStorage[] = [];

class MemoryStorage implements Storage {
    private readonly items = new Map<string, string>();
    constructor() {
        storages.push(this);
    }
    get length() {
        return this.items.size;
    }
    clear() {
        this.items.clear();
    }
    getItem(key: string) {
        return this.items.get(key) ?? null;
    }
    key(index: number) {
        return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.items.delete(key);
    }
    setItem(key: string, value: string) {
        this.items.set(key, String(value));
    }
    snapshot() {
        return Object.fromEntries(this.items);
    }
}

/** The secret fields of one token request and its answer (CHAOS-12369). */
function harvestSecrets(form: Record<string, string>, answer: Record<string, unknown>) {
    const found: [keyof typeof secretsByKind, unknown][] = [
        ["code", form.code],
        ["verifier", form.code_verifier],
        ["refresh", form.refresh_token],
        ["access", answer.access_token],
        ["refresh", answer.refresh_token],
    ];
    for (const [kind, value] of found) {
        if (typeof value === "string" && value !== "") secretsByKind[kind].add(value);
    }
}

/** What the browser asked the host's route, as the route read it. */
type RouteBody = { readonly code_challenge: string; readonly state: string };

/** The state of a route call, a secret for the log guard (CHAOS-12369). */
function routeBodyOf(init: RequestInit | undefined): RouteBody {
    const body = JSON.parse(String(init?.body)) as RouteBody;
    secretsByKind.state.add(body.state);
    return body;
}

type Call = { url: string; init: RequestInit | undefined };

let now = 1_800_000_000_000;
let storage: MemoryStorage;
let calls: Call[];
let tokenResponse: () => Response;
/** What the host's route answers: by default the code for the state it was sent. */
let routeResponse: (body: RouteBody) => Response;
/** What `/api/auth/session` answers when the session read gave nothing: by default a live session. */
let sessionAnswer: () => Response;
let metadata: unknown;
/**
 * What the fake `principal` seam answers: the current web session, null (signed out) or an
 * impersonating session (CHAOS-12306).
 */
let principal: AcrPrincipalRead;
/** Session reads to answer first, in order, before `principal`. */
let scriptedReads: AcrPrincipalRead[] = [];
/** An impersonating web session: the seam's answer while an admin impersonates (CHAOS-12306). */
const IMPERSONATING: AcrPrincipalRead = { impersonating: true };

function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** `null` = no configured client. (`undefined` would take the default.) */
function configure(tab: MemoryStorage, config: AcrBrowserClientConfig | null | undefined = CONFIG) {
    setAcrAuthDependenciesForTest({
        now: () => now,
        routes: ROUTES,
        principal: async () => (scriptedReads.length > 0 ? scriptedReads.shift()! : principal),
        storage: () => tab,
        config: () => config ?? undefined,
        channel: () => null,
        fetch: async (input, init) => {
            const url = String(input);
            calls.push({ url, init });
            if (url === `${ISSUER}/.well-known/oauth-authorization-server`)
                return json(200, metadata);
            if (url === ACR_AUTHORIZE_ROUTE) return routeResponse(routeBodyOf(init));
            if (url === "/api/auth/session") return sessionAnswer();
            if (url === `${ISSUER}/token`) {
                harvestSecrets(
                    Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))),
                    {},
                );
                return tokenResponse();
            }
            return json(404, {});
        },
    });
}

beforeEach(() => {
    storages = [];
    for (const level of Object.values(log)) level.mockClear();
    storage = new MemoryStorage();
    calls = [];
    principal = USER;
    getSession.mockReset();
    metadata = METADATA;
    tokenResponse = () =>
        json(200, {
            access_token: ACCESS,
            token_type: "Bearer",
            expires_in: 600,
            scope: ACR_BROWSER_SCOPE,
            refresh_token: REFRESH,
        });
    routeResponse = ({ state }) => json(200, { code: CODE, state, iss: ISSUER });
    sessionAnswer = () => json(200, { user: { id: "user-1" } });
    scriptedReads = [];
    configure(storage);
});

afterEach(() => {
    for (const tab of storages) {
        const id = tab.getItem(ACR_TAB_KEY);
        if (id !== null) secretsByKind.tab.add(id);
    }
    setAcrAuthDependenciesForTest();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** A tab duplicated (or opened with window.open): it gets a copy of this tab's sessionStorage. */
function duplicate(tab: MemoryStorage): MemoryStorage {
    const copy = new MemoryStorage();
    for (const [key, value] of Object.entries(tab.snapshot())) copy.setItem(key, value);
    return copy;
}

/** Real event-loop turns (setImmediate is never faked here). */
async function turns(count: number) {
    for (let turn = 0; turn < count; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function tokenCalls() {
    return calls.filter((call) => call.url === `${ISSUER}/token`);
}

function routeCalls() {
    return calls.filter((call) => call.url === ACR_AUTHORIZE_ROUTE);
}

/** What `tab` asked the route, and sent to `/token`, in its one authorization. */
function askedAndExchanged() {
    const [route] = routeCalls();
    const [exchange] = tokenCalls();
    return {
        route: routeBodyOf(route!.init),
        form: Object.fromEntries(exchange!.init!.body as URLSearchParams),
    };
}

describe("authorizeAcrSilently: the ask", () => {
    it("asks the host's route with the challenge and the state, and only them", async () => {
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token", token: ACCESS });
        const [route] = routeCalls();
        expect(route!.init).toMatchObject({
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            // A session that ended is the proxy's redirect, which this call must see, not follow.
            redirect: "manual",
        });
        const { route: body } = askedAndExchanged();
        expect(Object.keys(body).sort()).toEqual(["code_challenge", "state"]);
        expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(body.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    });

    it("keeps the verifier: it goes to ACR's /token, and in no request to web", async () => {
        await authorizeAcrSilently();
        const { route, form } = askedAndExchanged();
        const verifier = form.code_verifier!;
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(route.code_challenge).toBe(await pkceChallenge(verifier));
        expect(String(routeCalls()[0]!.init?.body)).not.toContain(verifier);
        expect(JSON.stringify(routeCalls()[0]!.init?.headers)).not.toContain(verifier);
        expect(routeCalls()[0]!.url).not.toContain(verifier);
    });

    it("stores no verifier and no state anywhere while it runs (r1 on #1663, moved)", async () => {
        const seen: string[] = [];
        routeResponse = ({ state }) => {
            seen.push(JSON.stringify(storage.snapshot()));
            return json(200, { code: CODE, state, iss: ISSUER });
        };
        await authorizeAcrSilently();
        const { route, form } = askedAndExchanged();
        expect(seen).toHaveLength(1);
        // So a duplicated tab copies nothing it could finish this authorization with.
        expect(seen[0]).not.toContain(route.state);
        expect(seen[0]).not.toContain(form.code_verifier);
    });

    it("computes S256 as RFC 7636 appendix B does", async () => {
        expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    });

    it("draws a new state and verifier every time", async () => {
        await authorizeAcrSilently();
        reportAcrTokenRejected(ACCESS);
        await authorizeAcrSilently();
        const [first, second] = routeCalls().map((call) => routeBodyOf(call.init));
        expect(first!.state).not.toBe(second!.state);
        expect(first!.code_challenge).not.toBe(second!.code_challenge);
    });

    it("reads the metadata with no credential and no cache", async () => {
        await authorizeAcrSilently();
        expect(calls[0]).toMatchObject({
            url: `${ISSUER}/.well-known/oauth-authorization-server`,
            init: { method: "GET", credentials: "omit", cache: "no-store", redirect: "error" },
        });
    });

    it("is off without a configured client, and sends nothing", async () => {
        configure(storage, null);
        expect(await authorizeAcrSilently()).toEqual({ kind: "off" });
        expect(calls).toEqual([]);
    });

    it("does not ask the route when the metadata cannot be read", async () => {
        metadata = { ...METADATA, issuer: "https://other.example" };
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "unavailable" });
        expect(routeCalls()).toEqual([]);
    });

    it("sends nothing while impersonating: no metadata read, no route call (CHAOS-12306)", async () => {
        principal = IMPERSONATING;
        expect(await authorizeAcrSilently()).toEqual({ kind: "impersonating" });
        expect(calls).toEqual([]);
    });

    it("drops a family stored before the impersonation started (codex r1 on #1680)", async () => {
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(STORED_FAMILY));
        principal = IMPERSONATING;
        expect(await authorizeAcrSilently()).toEqual({ kind: "impersonating" });
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    // Codex r1 P2 on #1714: a code the route issued for user A was stored as user B's family.
    it("makes no attempt when the first session read gives nothing: no code can reach another user", async () => {
        scriptedReads = [null];
        principal = { userId: "user-b", orgId: "org-1" };
        expect(await authorizeAcrSilently()).toEqual({
            kind: "failed",
            reason: "principal_unknown",
        });
        expect(routeCalls()).toEqual([]);
        expect(tokenCalls()).toEqual([]);
        expect(readAcrHeldFamily()).toBeNull();
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    it("refuses a code when the session changed from A to B: no /token call and no family", async () => {
        scriptedReads = [USER];
        principal = { userId: "user-b", orgId: "org-1" };
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "signed_out" });
        expect(routeCalls()).toHaveLength(1);
        expect(tokenCalls()).toEqual([]);
        expect(readAcrHeldFamily()).toBeNull();
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    // The read gives null both for no session and for a failed read. The endpoint can say which,
    // as `UserMenu` asks it. A session that ended still goes to the normal sign-in.
    it.each([
        ["null", () => json(200, null)],
        ["an empty object", () => json(200, {})],
    ])(
        "with no session read and %s from the endpoint, the session has ended",
        async (_, answer) => {
            principal = null;
            sessionAnswer = answer;
            expect(await authorizeAcrSilently()).toEqual({ kind: "session_ended" });
            expect(routeCalls()).toEqual([]);
            expect(calls.map((call) => call.url)).toEqual(["/api/auth/session"]);
            expect(calls[0]!.init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
        },
    );

    it.each([
        ["a live session", () => json(200, { user: { id: "user-1" } })],
        ["a 503", () => json(503, {})],
        ["no JSON", () => new Response("<html>", { status: 200 })],
        [
            "no answer",
            () => {
                throw new TypeError("Failed to fetch");
            },
        ],
    ])(
        "with no session read and %s from the endpoint, it is a named failure",
        async (_, answer) => {
            principal = null;
            sessionAnswer = answer;
            expect(await authorizeAcrSilently()).toEqual({
                kind: "failed",
                reason: "principal_unknown",
            });
            expect(routeCalls()).toEqual([]);
        },
    );

    it("the next act tries again when the session reads", async () => {
        scriptedReads = [null];
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "failed" });
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token" });
        expect(routeCalls()).toHaveLength(1);
    });

    it("reads no session while the client is off (prod until the T13 roll)", async () => {
        const read = vi.fn(async () => principal);
        configure(storage, null);
        setAcrAuthDependenciesForTest({
            config: () => undefined,
            routes: ROUTES,
            storage: () => storage,
            principal: read,
            channel: () => null,
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "off" });
        expect(read).not.toHaveBeenCalled();
    });

    it("never touches the location, whatever it ends in", async () => {
        const location = new Proxy(
            {},
            {
                get: () => {
                    throw new Error("the store read window.location");
                },
                set: () => {
                    throw new Error("the store wrote window.location");
                },
            },
        );
        vi.stubGlobal("window", { location });
        await authorizeAcrSilently();
        reportAcrTokenRejected(ACCESS);
        routeResponse = () => json(401, {});
        expect(await authorizeAcrSilently()).toEqual({ kind: "session_ended" });
    });

    it("sends no request when it is imported, and getAcrAccessToken never starts it", async () => {
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        expect(calls).toEqual([]);
    });
});

describe("authorizeAcrSilently: what the route answers", () => {
    it.each([
        ["401", () => json(401, { error: { code: "signed_out" } }), { kind: "session_ended" }],
        ["429", () => json(429, { error: { code: "rate_limited" } }), { kind: "rate_limited" }],
        [
            "429 from the host's budget",
            () => json(429, { error: { code: "user_rate_limited" } }),
            { kind: "rate_limited" },
        ],
        [
            "403 impersonating",
            () => json(403, { error: { code: "impersonating" } }),
            { kind: "impersonating" },
        ],
        [
            "403 not_entitled",
            () => json(403, { error: { code: "not_entitled" } }),
            { kind: "not_entitled" },
        ],
        ["404 client_off", () => json(404, { error: { code: "client_off" } }), { kind: "off" }],
        [
            "403 origin_refused",
            () => json(403, { error: { code: "origin_refused" } }),
            { kind: "failed", reason: "refused" },
        ],
        [
            "502 acr_refused",
            () => json(502, { error: { code: "acr_refused" } }),
            { kind: "failed", reason: "refused" },
        ],
        [
            "503 acr_unavailable",
            () => json(503, { error: { code: "acr_unavailable" } }),
            { kind: "failed", reason: "unavailable" },
        ],
        [
            "the proxy's 503, in text",
            () => new Response("Service temporarily unavailable.", { status: 503 }),
            { kind: "failed", reason: "unavailable" },
        ],
        [
            "the proxy's redirect to sign-in",
            () => ({ type: "opaqueredirect", status: 0, ok: false }) as Response,
            { kind: "session_ended" },
        ],
        [
            "no JSON",
            () => new Response("<html>", { status: 200 }),
            { kind: "failed", reason: "invalid_answer" },
        ],
    ] as const)("%s: named, and no token", async (_, answer, outcome) => {
        routeResponse = answer;
        expect(await authorizeAcrSilently()).toEqual(outcome);
        expect(tokenCalls()).toEqual([]);
        expect(readAcrHeldFamily()).toBeNull();
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    });

    it.each([
        ["no code", { state: "x", iss: ISSUER }],
        ["an empty code", { code: "", state: "x", iss: ISSUER }],
        ["no state", { code: CODE, iss: ISSUER }],
        ["no iss", { code: CODE, state: "x" }],
        ["a list", [CODE]],
    ])("a 200 with %s is an invalid answer", async (_, body) => {
        routeResponse = () => json(200, body);
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "invalid_answer" });
        expect(tokenCalls()).toEqual([]);
    });

    it("exchanges the code with a form POST and holds the token in memory only", async () => {
        expect(await authorizeAcrSilently()).toEqual({
            kind: "token",
            token: ACCESS,
            issuer: ISSUER,
        });

        const [exchange] = tokenCalls();
        expect(exchange!.init).toMatchObject({
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "omit",
            cache: "no-store",
        });
        // Only CORS-safelisted headers: the browser sends it with no preflight.
        expect(Object.keys(exchange!.init!.headers as Record<string, string>)).toEqual([
            "Content-Type",
        ]);
        const form = Object.fromEntries(exchange!.init!.body as URLSearchParams);
        expect(form).toEqual({
            grant_type: "authorization_code",
            code: CODE,
            redirect_uri: `${WEB}/ask-dev/oauth/callback`,
            client_id: `${WEB}/oauth/acr-client.json`,
            code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
            resource: ISSUER,
        });

        expect(await getAcrAccessToken()).toEqual({ kind: "token", token: ACCESS, issuer: ISSUER });
        // The access token is in no storage; the refresh token only in the family entry.
        const stored = JSON.stringify(storage.snapshot());
        expect(stored).not.toContain(ACCESS);
        // CHAOS-12305: v2, a random family id (the refresh lock's name), bound to the web principal.
        expect(readAcrHeldFamily()).toEqual({
            v: 2,
            familyId: expect.stringMatching(TAB_ID),
            issuer: ISSUER,
            clientId: `${WEB}/oauth/acr-client.json`,
            refreshToken: REFRESH,
            tokenEndpoint: `${ISSUER}/token`,
            revocationEndpoint: `${ISSUER}/revoke`,
            userId: "user-1",
            orgId: "org-1",
        });
    });

    /** The route answers the code, and `then` changes the world while it does. */
    function whileTheRouteAnswers(then: () => void) {
        routeResponse = ({ state }) => {
            then();
            return json(200, { code: CODE, state, iss: ISSUER });
        };
    }

    it("with no web session at the exchange, sends no code and stores nothing (CHAOS-12305)", async () => {
        whileTheRouteAnswers(() => {
            principal = null;
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "signed_out" });
        expect(tokenCalls()).toEqual([]);
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    it("while impersonating at the exchange, sends no code and stores nothing (CHAOS-12306)", async () => {
        whileTheRouteAnswers(() => {
            principal = IMPERSONATING;
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "impersonating" });
        expect(tokenCalls()).toEqual([]);
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    it("while impersonating at the exchange, also drops a family stored before (codex r1 on #1680)", async () => {
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(STORED_FAMILY));
        whileTheRouteAnswers(() => {
            principal = IMPERSONATING;
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "impersonating" });
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    it("binds a code to the session that asked: another user at the exchange gets nothing", async () => {
        whileTheRouteAnswers(() => {
            principal = { userId: "user-2", orgId: "org-1" };
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "signed_out" });
        expect(tokenCalls()).toEqual([]);
    });

    it("draws a new family id for every exchange", async () => {
        await authorizeAcrSilently();
        const first = readAcrHeldFamily()!.familyId;
        reportAcrTokenRejected(ACCESS);
        await authorizeAcrSilently();
        expect(readAcrHeldFamily()!.familyId).not.toBe(first);
    });

    it("while the client turned off during the ask, sends no code and stores nothing", async () => {
        whileTheRouteAnswers(() => configure(storage, null));
        expect(await authorizeAcrSilently()).toEqual({ kind: "off" });
        expect(tokenCalls()).toEqual([]);
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
    });

    it("refuses a state this tab did not send, and sends no code", async () => {
        routeResponse = () => json(200, { code: CODE, state: "x".repeat(43), iss: ISSUER });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "state_mismatch" });
        expect(tokenCalls()).toEqual([]);
        expect(readAcrHeldFamily()).toBeNull();
    });

    it("refuses an answer once the tab's id is another's (a copied tab)", async () => {
        whileTheRouteAnswers(() => {
            storage.setItem(ACR_TAB_KEY, "O".repeat(22));
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "wrong_tab" });
        expect(tokenCalls()).toEqual([]);
    });

    it("refuses an answer after the authorization expired", async () => {
        whileTheRouteAnswers(() => {
            now += ACR_AUTHORIZATION_TTL_MS;
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "expired" });
        expect(tokenCalls()).toEqual([]);
    });

    it.each([
        ["another iss", "https://evil.example"],
        ["an empty iss", ""],
    ])("refuses %s", async (_, iss) => {
        routeResponse = ({ state }) => json(200, { code: CODE, state, iss });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "iss_mismatch" });
        expect(tokenCalls()).toEqual([]);
    });

    it("refuses an answer when the configured issuer changed since the ask", async () => {
        whileTheRouteAnswers(() => {
            configure(storage, acrBrowserClientConfig("https://acr2.fullchaos.dev", WEB));
        });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "iss_mismatch" });
        expect(tokenCalls()).toEqual([]);
    });

    it("maps a refused code (400 invalid_grant) to token_refused and holds nothing", async () => {
        tokenResponse = () => json(400, { error: "invalid_grant" });
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "token_refused" });
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    });

    it("maps a 503 to token_unavailable", async () => {
        tokenResponse = () => json(503, {});
        expect(await authorizeAcrSilently()).toEqual({
            kind: "failed",
            reason: "token_unavailable",
        });
    });

    it.each([
        ["an access token of another shape", { access_token: "eyJhbGciOi.x.y" }],
        ["another token type", { token_type: "DPoP" }],
        ["no lifetime", { expires_in: undefined }],
        ["a zero lifetime", { expires_in: 0 }],
        ["a refresh token of another shape", { refresh_token: "rt-1" }],
    ])("refuses a token response with %s", async (_, change) => {
        tokenResponse = () =>
            json(200, {
                access_token: ACCESS,
                token_type: "Bearer",
                expires_in: 600,
                refresh_token: REFRESH,
                ...change,
            });
        expect(await authorizeAcrSilently()).toEqual({
            kind: "failed",
            reason: "invalid_token_response",
        });
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    });

    it("holds no family when ACR gives no refresh token", async () => {
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify({ v: 1, stale: true }));
        tokenResponse = () =>
            json(200, { access_token: ACCESS, token_type: "Bearer", expires_in: 600 });
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token" });
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
    });
});

describe("two callers in one tab (CHAOS-12474)", () => {
    it("make one authorization, and share its token", async () => {
        const [first, second, third] = await Promise.all([
            authorizeAcrSilently(),
            authorizeAcrSilently(),
            authorizeAcrSilently(),
        ]);
        expect(first).toMatchObject({ kind: "token", token: ACCESS });
        expect(second).toEqual(first);
        expect(third).toEqual(first);
        expect(routeCalls()).toHaveLength(1);
        expect(tokenCalls()).toHaveLength(1);
    });

    it("make one attempt when it fails too: one failure, not two calls to ACR's limit", async () => {
        routeResponse = () => json(429, { error: { code: "rate_limited" } });
        const outcomes = await Promise.all([authorizeAcrSilently(), authorizeAcrSilently()]);
        expect(outcomes).toEqual([{ kind: "rate_limited" }, { kind: "rate_limited" }]);
        expect(routeCalls()).toHaveLength(1);
    });

    it("a caller that read no token before the attempt ended gets its token, with no request", async () => {
        await authorizeAcrSilently();
        const sent = calls.length;
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token", token: ACCESS });
        expect(calls).toHaveLength(sent);
    });

    it("the next act after a failure tries again, once", async () => {
        routeResponse = () => json(503, {});
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "failed" });
        routeResponse = ({ state }) => json(200, { code: CODE, state, iss: ISSUER });
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token" });
        expect(routeCalls()).toHaveLength(2);
    });

    it("does not take a token held for another principal for an answer", async () => {
        await authorizeAcrSilently();
        principal = { userId: "user-2", orgId: "org-1" };
        await authorizeAcrSilently();
        expect(routeCalls()).toHaveLength(2);
    });

    it("gives no token when a fetch throws where nothing expects it", async () => {
        routeResponse = () => {
            throw new TypeError("Failed to fetch");
        };
        expect(await authorizeAcrSilently()).toEqual({ kind: "failed", reason: "unavailable" });
    });
});

describe("discoverAcrAuthorizationServer", () => {
    it.each([
        ["another issuer", { issuer: "https://other.example" }],
        ["no S256", { code_challenge_methods_supported: ["plain"] }],
        ["no iss parameter", { authorization_response_iss_parameter_supported: false }],
        [
            "an authorize endpoint on another origin",
            { authorization_endpoint: "https://evil.example/authorize" },
        ],
        ["a token endpoint on another origin", { token_endpoint: "https://evil.example/token" }],
        [
            "a revocation endpoint on another origin",
            { revocation_endpoint: "https://evil.example/revoke" },
        ],
        [
            "a token endpoint with user info",
            { token_endpoint: `https://u@acr.fullchaos.dev/token` },
        ],
    ])("refuses metadata with %s", async (_, change) => {
        metadata = { ...METADATA, ...change };
        expect(await discoverAcrAuthorizationServer(ISSUER)).toBeNull();
    });

    it("accepts metadata with no revocation endpoint (no browser refresh grant)", async () => {
        const { revocation_endpoint: _omitted, ...rest } = METADATA;
        metadata = rest;
        expect(await discoverAcrAuthorizationServer(ISSUER)).toEqual({
            issuer: ISSUER,
            authorizationEndpoint: `${ISSUER}/authorize`,
            tokenEndpoint: `${ISSUER}/token`,
            revocationEndpoint: null,
        });
    });
});

describe("deadlines (r3 on #1663)", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    /** Real turns until the request to `url` is in flight (only setTimeout is faked). */
    async function untilInFlight(url: string) {
        const until = Date.now() + 5_000;
        while (!calls.some((call) => call.url === url) && Date.now() < until) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    /** A fetch that never answers `url`, until its signal aborts. */
    function stalled(url: string) {
        return (input: RequestInfo | URL, init?: RequestInit) => {
            const called = String(input);
            calls.push({ url: called, init });
            if (called === `${ISSUER}/.well-known/oauth-authorization-server` && called !== url) {
                return Promise.resolve(json(200, metadata));
            }
            if (called === ACR_AUTHORIZE_ROUTE && called !== url) {
                return Promise.resolve(routeResponse(routeBodyOf(init)));
            }
            return new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
            });
        };
    }

    async function endsAtTheDeadline(url: string, reason: string) {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        setAcrAuthDependenciesForTest({
            now: () => now,
            routes: ROUTES,
            principal: async () => principal,
            storage: () => storage,
            config: () => CONFIG,
            channel: () => null,
            lock: (_name, task) => task(),
            fetch: stalled(url),
        });
        const outcome = authorizeAcrSilently();
        await untilInFlight(url);
        expect(calls.filter((call) => call.url === url)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(ACR_OAUTH_REQUEST_TIMEOUT_MS - 1);
        let settled = false;
        void outcome.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await outcome).toEqual({ kind: "failed", reason });
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    }

    it("gives up on metadata ACR never answers, after ACR_OAUTH_REQUEST_TIMEOUT_MS", async () => {
        await endsAtTheDeadline(`${ISSUER}/.well-known/oauth-authorization-server`, "unavailable");
        expect(routeCalls()).toEqual([]);
    });

    it("gives up on a route that never answers", async () => {
        await endsAtTheDeadline(ACR_AUTHORIZE_ROUTE, "unavailable");
        expect(tokenCalls()).toEqual([]);
    });

    it("gives up on a token exchange ACR never answers, and holds nothing", async () => {
        await endsAtTheDeadline(`${ISSUER}/token`, "token_unavailable");
    });
});

describe("getAcrAccessToken", () => {
    async function authorized() {
        expect(await authorizeAcrSilently()).toMatchObject({ kind: "token" });
    }

    it("asks for authorization before any flow, and is off without a client", async () => {
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        configure(storage, null);
        expect(await getAcrAccessToken()).toEqual({ kind: "off" });
    });

    it.each([
        ["c2's shape", "c2"],
        ["every v2 field", "v2-fields"],
    ])("ignores a v:1 family entry with %s (CHAOS-12305)", async (_, shape) => {
        const { familyId: _id, userId: _user, orgId: _org, ...c2 } = STORED_FAMILY;
        const entry = shape === "c2" ? { ...c2, v: 1 } : { ...STORED_FAMILY, v: 1 };
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(entry));
        expect(readAcrHeldFamily()).toBeNull();
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        expect(tokenCalls()).toEqual([]);
    });

    it("drops a held token of another principal when no family is held (CHAOS-12305)", async () => {
        tokenResponse = () =>
            json(200, { access_token: ACCESS, token_type: "Bearer", expires_in: 600 });
        await authorized();
        expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
        principal = { userId: "user-2", orgId: "org-1" };
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        principal = USER;
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    });

    it("never serves a token to another configured client", async () => {
        await authorized();
        configure(storage, acrBrowserClientConfig("https://acr2.fullchaos.dev", WEB));
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
    });

    it("while impersonating, drops the family and the held token and sends no request (CHAOS-12306)", async () => {
        await authorized();
        expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
        expect(readAcrHeldFamily()).not.toBeNull();
        const sent = calls.length;
        // A refresh is due: impersonating still sends nothing.
        now += 480_000;
        principal = IMPERSONATING;
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        expect(calls).toHaveLength(sent);
        expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        // Both are gone: after the impersonation ends nothing is served and nothing is sent.
        principal = USER;
        now -= 480_000;
        expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        expect(calls).toHaveLength(sent);
    });
});

/**
 * CHAOS-12305 (c4): refresh across tabs, the principal binding, clone detection and the sign-out
 * hook. ACR is the c2 mock (`tests/mocks/acr-oauth.ts`), which keeps acr-api's refresh rules:
 * rotation, the 30 s grace for the same consumed token while its successor is unused, and
 * `invalid_grant` (family revoked) on any other reuse.
 */
describe("the token store across tabs (CHAOS-12305)", () => {
    type Tab = typeof defaultTab;
    type Fate = {
        /** What reaches the browser: ACR's own answer (default), a lost response, or another one. */
        readonly deliver?:
            "network" | "stall" | number | ((body: Record<string, unknown>) => unknown);
        /** Clock time the request takes after ACR answered. */
        readonly elapse?: number;
        /** Runs while the request is in flight, after ACR answered. */
        readonly during?: () => Promise<void>;
    };

    let acr: AcrOAuthMock;
    /** Every token request ACR answered: the form sent and ACR's answer (lost or not). */
    let tokenLog: { form: Record<string, string>; answer: Record<string, unknown> }[];
    /** What happens to each next token request, in order. */
    let fates: Fate[];
    let inFlight: number;
    let maxInFlight: number;
    let locks: ReturnType<typeof serialLock>;

    /** A Web Locks fake that really serializes: one promise chain per lock name. */
    function serialLock() {
        const tails = new Map<string, Promise<unknown>>();
        const names: string[] = [];
        function lock<T>(name: string, task: () => Promise<T>): Promise<T> {
            names.push(name);
            const run = (tails.get(name) ?? Promise.resolve()).then(task);
            tails.set(
                name,
                run.catch(() => undefined),
            );
            return run;
        }
        return { lock, names };
    }

    /** An in-memory BroadcastChannel: a post reaches every other tab's handlers, later. */
    function channelHub() {
        const tabs: ((message: unknown) => void)[][] = [];
        const posted: AcrTabMessage[] = [];
        return {
            posted,
            join(): AcrTabChannel {
                const handlers: ((message: unknown) => void)[] = [];
                tabs.push(handlers);
                return {
                    post: (message) => {
                        posted.push(message);
                        for (const other of tabs) {
                            if (other === handlers) continue;
                            for (const handler of [...other]) {
                                queueMicrotask(() => handler(structuredClone(message)));
                            }
                        }
                    },
                    onMessage: (handler) => {
                        handlers.push(handler);
                    },
                };
            },
        };
    }

    /** The host's route over this ACR: `/authorize` with the server's values, then no-click consent. */
    function webRoute({ code_challenge: challenge, state }: RouteBody): Response {
        const authorize = new URL(`${ISSUER}/authorize`);
        authorize.search = new URLSearchParams({
            response_type: "code",
            client_id: CONFIG.clientId,
            redirect_uri: CONFIG.redirectUri,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
            resource: ISSUER,
            scope: ACR_BROWSER_SCOPE,
        }).toString();
        const redirect = acr.handle({ method: "GET", url: authorize.href });
        const answer = new URL(redirect.headers.Location!).searchParams;
        return json(200, {
            code: answer.get("code"),
            state: answer.get("state"),
            iss: answer.get("iss"),
        });
    }

    async function acrFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = String(input);
        calls.push({ url, init });
        const isToken = url === `${ISSUER}/token`;
        const fate: Fate = isToken ? (fates.shift() ?? {}) : {};
        if (isToken) {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
        }
        try {
            // Real turns, so two requests would overlap if nothing serialized them.
            await turns(5);
            const body = init?.body === undefined || init.body === null ? null : String(init.body);
            if (url === ACR_AUTHORIZE_ROUTE) return webRoute(routeBodyOf(init));
            const answer = acr.handle({ method: init?.method ?? "GET", url, body });
            if (isToken) {
                const entry = {
                    form: Object.fromEntries(new URLSearchParams(body ?? "")),
                    answer: JSON.parse(answer.body) as Record<string, unknown>,
                };
                tokenLog.push(entry);
                harvestSecrets(entry.form, entry.answer);
            }
            now += fate.elapse ?? 0;
            await fate.during?.();
            const { deliver } = fate;
            if (deliver === "network") throw new TypeError("Failed to fetch");
            if (deliver === "stall") {
                return await new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
                });
            }
            if (typeof deliver === "number") return json(deliver, { error: "server_error" });
            if (typeof deliver === "function") {
                return json(answer.status, deliver(JSON.parse(answer.body)));
            }
            return new Response(answer.body === "" ? null : answer.body, {
                status: answer.status,
                headers: answer.headers,
            });
        } finally {
            if (isToken) inFlight -= 1;
        }
    }

    function depsFor(tab: MemoryStorage, channel: AcrTabChannel | null | "browser" = null) {
        return {
            now: () => now,
            storage: () => tab,
            config: () => CONFIG,
            session: getSession,
            routes: ROUTES,
            principal: async () => principal,
            lock: locks.lock,
            fetch: acrFetch,
            ...(channel === "browser" ? {} : { channel: () => channel }),
        };
    }

    /** A new page load over `tab`'s sessionStorage: a fresh module, so no token in memory. */
    async function openTab(
        tab: MemoryStorage,
        channel: AcrTabChannel | null | "browser" = null,
    ): Promise<{ auth: Tab }> {
        vi.resetModules();
        const auth = await import("../auth");
        // A host starts the tab listener on every page (web's sign-out hook does at load).
        auth.listenForAcrTabs();
        auth.setAcrAuthDependenciesForTest(depsFor(tab, channel));
        return { auth };
    }

    /** The whole flow at ACR: the ask, the host's route with ACR's no-click consent, the exchange. */
    async function signIn(auth: Tab = defaultTab) {
        expect(await auth.authorizeAcrSilently()).toMatchObject({ kind: "token" });
    }

    function refreshLog() {
        return tokenLog.filter((entry) => entry.form.grant_type === "refresh_token");
    }

    function storedFamily(tab: MemoryStorage = storage) {
        const raw = tab.getItem(ACR_TOKEN_FAMILY_KEY);
        return raw === null ? null : (JSON.parse(raw) as typeof STORED_FAMILY);
    }

    /** 80 % of the 600 s life the mock gives: from here the token is refreshed. */
    const REFRESH_AT_MS = 480_000;

    beforeEach(() => {
        acr = new AcrOAuthMock({
            issuer: ISSUER,
            redirectUri: CONFIG.redirectUri,
            clientId: CONFIG.clientId,
            now: () => now,
        });
        tokenLog = [];
        fates = [];
        inFlight = 0;
        maxInFlight = 0;
        locks = serialLock();
        setAcrAuthDependenciesForTest(depsFor(storage));
    });

    describe("the principal binding", () => {
        it("binds the family and the token to the web user and org", async () => {
            await signIn();
            expect(storedFamily()).toMatchObject({ v: 2, userId: "user-1", orgId: "org-1" });
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
        });

        it.each([
            ["a user switch", { userId: "user-2", orgId: "org-1" }],
            ["an org switch", { userId: "user-1", orgId: "org-2" }],
            ["an org that is gone", { userId: "user-1", orgId: null }],
            ["no session", null],
        ])("drops the family and the token on %s", async (_, next) => {
            await signIn();
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            principal = next;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            // Both are gone: back as the first user, nothing is served and nothing is sent.
            principal = USER;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
        });

        it("drops a stored family of another principal after a reload, and sends nothing", async () => {
            storage.setItem(
                ACR_TOKEN_FAMILY_KEY,
                JSON.stringify({ ...STORED_FAMILY, userId: "user-2" }),
            );
            const { auth } = await openTab(storage);
            expect(await auth.getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(tokenLog).toEqual([]);
        });

        it("drops both when the stored family names another principal, even with a fresh token", async () => {
            await signIn();
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            storage.setItem(
                ACR_TOKEN_FAMILY_KEY,
                JSON.stringify({ ...storedFamily(), userId: "user-2" }),
            );
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
        });

        it("re-checks the principal of the family it re-reads inside the lock", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            // Another document wrote the entry for another user while this call waited.
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                lock: (name, task) => {
                    storage.setItem(
                        ACR_TOKEN_FAMILY_KEY,
                        JSON.stringify({ ...storedFamily(), userId: "user-2" }),
                    );
                    return locks.lock(name, task);
                },
            });
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        });

        it("reads the principal from the host's session", async () => {
            const { principal: _fake, ...browserPrincipal } = depsFor(storage);
            setAcrAuthDependenciesForTest(browserPrincipal);
            getSession.mockResolvedValue({ user: { id: "user-1", org_id: "org-1" }, expires: "" });
            await signIn();
            expect(storedFamily()).toMatchObject({ userId: "user-1", orgId: "org-1" });
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });

            getSession.mockResolvedValue({ user: { id: "user-1" }, expires: "" });
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();

            getSession.mockResolvedValue({ user: { id: "user-1", org_id: "org-1" }, expires: "" });
            await signIn();
            getSession.mockRejectedValue(new TypeError("Failed to fetch"));
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();

            getSession.mockResolvedValue(null);
            expect(await defaultTab.authorizeAcrSilently()).toEqual({
                kind: "failed",
                reason: "principal_unknown",
            });
        });

        it("reads is_impersonating from the host's session: user.id stays the admin's (CHAOS-12306)", async () => {
            const { principal: _fake, ...browserPrincipal } = depsFor(storage);
            setAcrAuthDependenciesForTest(browserPrincipal);
            const admin = { id: "user-1", org_id: "org-1" };
            const impersonating = {
                user: { ...admin, is_impersonating: true, impersonated_user_id: "user-9" },
                expires: "",
            };
            getSession.mockResolvedValue({ user: admin, expires: "" });
            await signIn();
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });

            // Same user id, same org: c4's binding alone would serve the token.
            getSession.mockResolvedValue(impersonating);
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            const sent = calls.length;
            expect(await defaultTab.authorizeAcrSilently()).toEqual({ kind: "impersonating" });
            expect(calls).toHaveLength(sent);

            // The impersonation starts while the route answers: the code is not sent.
            getSession.mockResolvedValue(impersonating);
            getSession.mockResolvedValueOnce({ user: admin, expires: "" });
            const tokenRequests = tokenCalls().length;
            expect(await defaultTab.authorizeAcrSilently()).toEqual({ kind: "impersonating" });
            expect(tokenCalls()).toHaveLength(tokenRequests);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        });
    });

    describe("refresh", () => {
        it("serves the token before 80 % of its life, and refreshes it from there", async () => {
            await signIn();
            const r0 = storedFamily()!.refreshToken;
            const first = await getAcrAccessToken();
            expect(first).toMatchObject({ kind: "token" });
            now += REFRESH_AT_MS - 1;
            expect(await getAcrAccessToken()).toEqual(first);
            expect(refreshLog()).toEqual([]);

            now += 1;
            const second = await getAcrAccessToken();
            const [refresh] = refreshLog();
            expect(refresh!.form).toEqual({
                grant_type: "refresh_token",
                refresh_token: r0,
                client_id: CONFIG.clientId,
            });
            expect(second).toEqual({
                kind: "token",
                token: refresh!.answer.access_token,
                issuer: ISSUER,
            });
            expect(second).not.toEqual(first);
            // Rotation: the family now holds the new refresh token, under the same family id.
            expect(storedFamily()).toMatchObject({
                refreshToken: refresh!.answer.refresh_token,
                familyId: readAcrHeldFamily()!.familyId,
            });
            expect(storedFamily()!.refreshToken).not.toBe(r0);
            // A form POST with no credential and only safelisted headers (no preflight).
            const init = calls.filter((call) => call.url === `${ISSUER}/token`).at(-1)!.init!;
            expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store" });
            expect(Object.keys(init.headers as Record<string, string>)).toEqual(["Content-Type"]);
            expect(init.signal).toBeInstanceOf(AbortSignal);
            // The new token's own 80 % counts from when it was issued.
            now += REFRESH_AT_MS - 1;
            expect(await getAcrAccessToken()).toEqual(second);
            expect(refreshLog()).toHaveLength(1);
        });

        it("never serves a short-lived token within 30 s of its expiry", async () => {
            fates = [{ deliver: (body) => ({ ...body, expires_in: 100 }) }];
            await signIn();
            now += 70_000 - 1;
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(refreshLog()).toEqual([]);
            now += 1;
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(refreshLog()).toHaveLength(1);
        });

        it("refreshes on the first call after a reload (the family stays, the token does not)", async () => {
            await signIn();
            const { auth } = await openTab(storage);
            expect(await auth.getAcrAccessToken()).toEqual({
                kind: "token",
                token: expect.stringMatching(/^fcacr_/u),
                issuer: ISSUER,
            });
            expect(refreshLog()).toHaveLength(1);
        });

        it("makes one refresh for two concurrent calls in one tab", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            const [one, two] = await Promise.all([getAcrAccessToken(), getAcrAccessToken()]);
            expect(one).toMatchObject({ kind: "token" });
            expect(two).toEqual(one);
            expect(refreshLog()).toHaveLength(1);
            const familyId = storedFamily()!.familyId;
            expect(locks.names.filter((name) => name.startsWith("ask-dev:acr-refresh:"))).toEqual([
                `ask-dev:acr-refresh:${familyId}`,
                `ask-dev:acr-refresh:${familyId}`,
            ]);
        });

        it("serializes two documents on one family entry, and the second re-reads it inside the lock", async () => {
            await signIn();
            const r0 = storedFamily()!.refreshToken;
            const one = await openTab(storage);
            const two = await openTab(storage);
            const [a, b] = await Promise.all([
                one.auth.getAcrAccessToken(),
                two.auth.getAcrAccessToken(),
            ]);
            expect(maxInFlight).toBe(1);
            const [first, second] = refreshLog();
            expect(first!.form.refresh_token).toBe(r0);
            // The first's result: the rotated token, not the consumed one read before the lock.
            expect(second!.form.refresh_token).toBe(first!.answer.refresh_token);
            expect(a).toMatchObject({ kind: "token", token: first!.answer.access_token });
            expect(b).toMatchObject({ kind: "token", token: second!.answer.access_token });
            expect(storedFamily()!.refreshToken).toBe(second!.answer.refresh_token);
        });

        it("serializes a cloned tab that no check caught (the known limit): ACR's grace gives both the same successor", async () => {
            await signIn();
            const clone = duplicate(storage);
            const original = await openTab(storage);
            const copy = await openTab(clone);
            const [a, b] = await Promise.all([
                original.auth.getAcrAccessToken(),
                copy.auth.getAcrAccessToken(),
            ]);
            expect(maxInFlight).toBe(1);
            const [first, second] = refreshLog();
            expect(second!.form.refresh_token).toBe(first!.form.refresh_token);
            expect(second!.answer).toMatchObject({
                access_token: first!.answer.access_token,
                refresh_token: first!.answer.refresh_token,
            });
            expect(a).toEqual(b);
        });

        it.each([
            ["ACR's invalid_grant (the family was revoked)", "revoked"],
            ["a 401", 401],
            ["a 200 with no new refresh token", "no-refresh"],
            ["a 200 with an access token of another shape", "bad-access"],
        ] as const)("clears the family and the token on %s, and re-authorizes", async (_, kind) => {
            await signIn();
            const r0 = storedFamily()!.refreshToken;
            if (kind === "revoked") {
                acr.handle({
                    method: "POST",
                    url: `${ISSUER}/revoke`,
                    body: new URLSearchParams({ token: r0, client_id: CONFIG.clientId }).toString(),
                });
            } else if (kind === 401) {
                fates = [{ deliver: 401 }];
            } else if (kind === "no-refresh") {
                fates = [{ deliver: ({ refresh_token: _rt, ...body }) => body }];
            } else {
                fates = [{ deliver: (body) => ({ ...body, access_token: "eyJ.x.y" }) }];
            }
            now += REFRESH_AT_MS;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toHaveLength(1);

            await signIn();
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
        });

        it.each([
            ["a network error", "network"],
            ["a 503", 503],
        ] as const)(
            "retries a lost response (%s) once inside 25 s, with the same token, and takes ACR's successor",
            async (_, lost) => {
                await signIn();
                const r0 = storedFamily()!.refreshToken;
                now += REFRESH_AT_MS;
                fates = [{ deliver: lost, elapse: 24_999 }];
                const token = await getAcrAccessToken();
                const [lostOne, retry] = refreshLog();
                expect(refreshLog().map((entry) => entry.form.refresh_token)).toEqual([r0, r0]);
                // ACR rotated on the lost one; its grace gave the same successor to the retry.
                expect(retry!.answer).toMatchObject({
                    access_token: lostOne!.answer.access_token,
                    refresh_token: lostOne!.answer.refresh_token,
                });
                expect(token).toEqual({
                    kind: "token",
                    token: lostOne!.answer.access_token,
                    issuer: ISSUER,
                });
                expect(storedFamily()!.refreshToken).toBe(lostOne!.answer.refresh_token);
            },
        );

        it("counts a refresh ACR never answers as lost: the 15 s deadline ends it, then one retry", async () => {
            await signIn();
            const r0 = storedFamily()!.refreshToken;
            now += REFRESH_AT_MS;
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            fates = [{ deliver: "stall" }];
            const outcome = getAcrAccessToken();
            const until = Date.now() + 5_000;
            while (refreshLog().length === 0 && Date.now() < until) await turns(1);
            await turns(5);
            await vi.advanceTimersByTimeAsync(ACR_OAUTH_REQUEST_TIMEOUT_MS - 1);
            expect(refreshLog()).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(await outcome).toMatchObject({ kind: "token" });
            expect(refreshLog().map((entry) => entry.form.refresh_token)).toEqual([r0, r0]);
        });

        it.each([
            [
                "a lost response 25 s after the attempt started",
                [{ deliver: "network", elapse: 25_000 }],
            ],
            ["a failed retry", [{ deliver: "network" }, { deliver: 503 }]],
        ] as const)(
            "clears on %s, and never presents that refresh token again",
            async (_, plan) => {
                await signIn();
                now += REFRESH_AT_MS;
                fates = [...plan];
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(refreshLog()).toHaveLength(plan.length);
                expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(refreshLog()).toHaveLength(plan.length);
            },
        );
    });

    describe("reportAcrTokenRejected", () => {
        it("drops only the token it names, and keeps the family for a refresh", async () => {
            await signIn();
            const first = await getAcrAccessToken();
            if (first.kind !== "token") throw new Error("no token");
            reportAcrTokenRejected(`fcacr_${"Z".repeat(43)}`);
            expect(await getAcrAccessToken()).toEqual(first);
            expect(refreshLog()).toEqual([]);

            reportAcrTokenRejected(first.token);
            const second = await getAcrAccessToken();
            expect(refreshLog()).toHaveLength(1);
            expect(second).toMatchObject({ kind: "token" });
            expect(second).not.toEqual(first);
            // A late report for the old token does not drop the newer one.
            reportAcrTokenRejected(first.token);
            expect(await getAcrAccessToken()).toEqual(second);
            expect(refreshLog()).toHaveLength(1);
        });
    });

    describe("cloned tab detection", () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        });

        /** Lets a call's clone check end (its wait for `taken`), then gives its outcome. */
        async function settled<T>(call: Promise<T>): Promise<T> {
            await vi.advanceTimersByTimeAsync(ACR_CLONE_CHECK_MS);
            return call;
        }

        it("a clone gets taken, takes a new tab id and drops its copy; the original keeps its family", async () => {
            const hub = channelHub();
            const original = await openTab(storage, hub.join());
            await signIn(original.auth);
            const originalId = storage.getItem(ACR_TAB_KEY)!;
            const family = storage.getItem(ACR_TOKEN_FAMILY_KEY);

            const clone = duplicate(storage);
            const copy = await openTab(clone, hub.join());
            // No timer advance: the answer, not the wait, ends the clone's check.
            expect(await copy.auth.getAcrAccessToken()).toEqual({
                kind: "authorization_required",
            });
            expect(hub.posted).toEqual([
                { type: "hello", tabId: originalId },
                { type: "taken", tabId: originalId },
            ]);
            expect(clone.getItem(ACR_TAB_KEY)).toMatch(TAB_ID);
            expect(clone.getItem(ACR_TAB_KEY)).not.toBe(originalId);
            expect(clone.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBe(family);
            expect(refreshLog()).toEqual([]);

            // Once per page load: the clone does not ask again.
            expect(await settled(copy.auth.getAcrAccessToken())).toEqual({
                kind: "authorization_required",
            });
            expect(hub.posted).toHaveLength(2);

            // The original had no id to ask with at its first use, so it does not ask now.
            expect(await settled(original.auth.getAcrAccessToken())).toMatchObject({
                kind: "token",
            });
            expect(hub.posted).toHaveLength(2);
            expect(storage.getItem(ACR_TAB_KEY)).toBe(originalId);
        });

        it("waits the whole check when nobody answers, then serves", async () => {
            await signIn(await openTab(storage).then(({ auth }) => auth));
            // A page load with an id to ask about: nobody on this channel holds it.
            const tab = await openTab(storage, channelHub().join());
            let done = false;
            const call = tab.auth.getAcrAccessToken().finally(() => (done = true));
            await vi.advanceTimersByTimeAsync(ACR_CLONE_CHECK_MS - 1);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(await call).toMatchObject({ kind: "token" });
        });

        it("skips the check without BroadcastChannel: no wait, and the tab keeps its id and family", async () => {
            vi.stubGlobal("window", {});
            vi.stubGlobal("BroadcastChannel", undefined);
            const tab = await openTab(storage, "browser");
            await signIn(tab.auth);
            const id = storage.getItem(ACR_TAB_KEY);
            // No timer advance at all: a check would wait on the faked 200 ms timer.
            expect(await tab.auth.getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(storage.getItem(ACR_TAB_KEY)).toBe(id);
            expect(storedFamily()).not.toBeNull();
        });

        it("drops a refresh answer that lands after this tab was cleared", async () => {
            const hub = channelHub();
            const tab = await openTab(storage, hub.join());
            await signIn(tab.auth);
            const other = await openTab(new MemoryStorage(), hub.join());
            now += REFRESH_AT_MS;
            fates = [
                {
                    during: async () => {
                        other.auth.clearAcrTokensInAllTabs();
                        await turns(2);
                    },
                },
            ];
            expect(await settled(tab.auth.getAcrAccessToken())).toEqual({
                kind: "authorization_required",
            });
            expect(refreshLog()).toHaveLength(1);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(await tab.auth.getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toHaveLength(1);
        });
    });

    describe("clearing every tab", () => {
        it("clearAcrTokensInAllTabs clears this tab and tells the other tabs, which clear theirs", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const hub = channelHub();
            const here = await openTab(storage, hub.join());
            await signIn(here.auth);
            const elsewhere = new MemoryStorage();
            const there = await openTab(elsewhere, hub.join());
            await signIn(there.auth);
            expect(storedFamily(elsewhere)).not.toBeNull();

            here.auth.clearAcrTokensInAllTabs();
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(hub.posted).toContainEqual({ type: "clear" });
            await turns(2);
            expect(elsewhere.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();

            // Neither tab holds a token in memory any more, and neither sends anything.
            for (const tab of [here, there]) {
                const call = tab.auth.getAcrAccessToken();
                await vi.advanceTimersByTimeAsync(ACR_CLONE_CHECK_MS);
                expect(await call).toEqual({ kind: "authorization_required" });
            }
            expect(refreshLog()).toEqual([]);
        });
    });

    describe("codex r1 on #1676", () => {
        const EVIL = "https://evil.example";

        it("without Web Locks, one tab's concurrent calls still make one refresh", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            vi.stubGlobal("navigator", {});
            const { lock: _serial, ...browserLock } = depsFor(storage);
            setAcrAuthDependenciesForTest(browserLock);
            const [first, second] = await Promise.all([getAcrAccessToken(), getAcrAccessToken()]);
            expect(refreshLog()).toHaveLength(1);
            expect(maxInFlight).toBe(1);
            expect(first).toMatchObject({ kind: "token" });
            expect(second).toEqual(first);
        });

        it.each([
            ["another user and org", { userId: "user-2", orgId: "org-2" }],
            ["no session (signed out)", null],
        ])(
            "re-checks the principal after the refresh: %s meanwhile gets no token",
            async (_, next) => {
                await signIn();
                now += REFRESH_AT_MS;
                fates.push({
                    during: async () => {
                        principal = next;
                    },
                });
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(refreshLog()).toHaveLength(1);
                expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
                // The refreshed token is not held for later either.
                principal = USER;
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(refreshLog()).toHaveLength(1);
            },
        );

        it.each([
            ["a token endpoint on another origin", { tokenEndpoint: `${EVIL}/collect` }],
            ["a revocation endpoint on another origin", { revocationEndpoint: `${EVIL}/collect` }],
            ["another issuer", { issuer: EVIL }],
            [
                "another issuer with its own endpoints",
                {
                    issuer: EVIL,
                    tokenEndpoint: `${EVIL}/token`,
                    revocationEndpoint: `${EVIL}/revoke`,
                },
            ],
            ["another client", { clientId: `${WEB}/other-client.json` }],
        ])("never uses, refreshes or revokes a stored family with %s", async (_, change) => {
            storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify({ ...STORED_FAMILY, ...change }));
            expect(readAcrHeldFamily()).toBeNull();
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(calls.filter((call) => !call.url.startsWith(`${ISSUER}/`))).toEqual([]);
            expect(refreshLog()).toEqual([]);
        });

        it("holds no family while the client is off", () => {
            storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(STORED_FAMILY));
            setAcrAuthDependenciesForTest({ ...depsFor(storage), config: () => undefined });
            expect(readAcrHeldFamily()).toBeNull();
        });

        it("without BroadcastChannel, another tab's family is unusable after sign-out: the web session is gone", async () => {
            const here = await openTab(storage, null);
            await signIn(here.auth);
            const elsewhere = new MemoryStorage();
            const there = await openTab(elsewhere, null);
            await signIn(there.auth);
            expect(await there.auth.getAcrAccessToken()).toMatchObject({ kind: "token" });

            here.auth.clearAcrTokensInAllTabs();
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            // No channel: the other tab was not told. a sign-out then ends the web session.
            expect(elsewhere.getItem(ACR_TOKEN_FAMILY_KEY)).not.toBeNull();
            principal = null;
            expect(await there.auth.getAcrAccessToken()).toEqual({
                kind: "authorization_required",
            });
            expect(elsewhere.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(refreshLog()).toEqual([]);
        });
    });

    describe("codex r2 on #1676: a clear while a request is in flight wins", () => {
        function codeExchanges() {
            return tokenLog.filter((entry) => entry.form.grant_type === "authorization_code");
        }

        const exchange = () => defaultTab.authorizeAcrSilently();

        it("a clear while the principal is read (an observed impersonation start or org switch): the held token is not served (codex r3 on #1680)", async () => {
            await signIn();
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    // The tab observes the change while this read is in flight: c5 clears.
                    defaultTab.clearAcrTokensInAllTabs();
                    return principal;
                },
            });
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
        });

        it("a sign-out during the principal check after a refresh: no token, nothing held", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            let reads = 0;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    reads += 1;
                    // The second read is the check after the refresh: sign-out clears meanwhile.
                    if (reads === 2) defaultTab.clearAcrTokensInAllTabs();
                    return principal;
                },
            });
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(reads).toBe(2);
            expect(refreshLog()).toHaveLength(1);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toHaveLength(1);
        });

        it("a sign-out while the code exchange is in flight: nothing is stored or held", async () => {
            fates.push({ during: async () => defaultTab.clearAcrTokensInAllTabs() });
            expect(await exchange()).toMatchObject({ kind: "failed", reason: "signed_out" });
            expect(codeExchanges()).toHaveLength(1);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
        });

        it("a clear while the route answers: the code is not sent", async () => {
            let reads = 0;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    reads += 1;
                    // The second read is after the route answered.
                    if (reads === 2) defaultTab.clearAcrTokensInAllTabs();
                    return principal;
                },
            });
            expect(await exchange()).toMatchObject({ kind: "failed", reason: "signed_out" });
            expect(codeExchanges()).toEqual([]);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        });

        it("an impersonation started while the code exchange ran: nothing is stored or held (CHAOS-12306)", async () => {
            // A family this tab held from before goes too (codex r1 on #1680).
            storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(STORED_FAMILY));
            fates.push({
                during: async () => {
                    principal = IMPERSONATING;
                },
            });
            expect(await exchange()).toEqual({ kind: "impersonating" });
            expect(codeExchanges()).toHaveLength(1);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            principal = USER;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(refreshLog()).toEqual([]);
        });

        it.each([
            ["another user", { userId: "user-2", orgId: "org-1" }],
            ["another org", { userId: "user-1", orgId: "org-2" }],
            ["no session", null],
        ])("%s by the end of the code exchange: nothing is stored or held", async (_, next) => {
            fates.push({
                during: async () => {
                    principal = next;
                },
            });
            expect(await exchange()).toMatchObject({ kind: "failed", reason: "signed_out" });
            expect(codeExchanges()).toHaveLength(1);
            expect(storage.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
            principal = USER;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
        });
    });

    /**
     * CHAOS-12369: the failure and refusal paths log at Info or Warn, once per event, with no secret
     * value. Fields are family id, enums, booleans and an HTTP status only.
     */
    describe("logs (CHAOS-12369)", () => {
        const SENT = "ask-dev acr token store refresh sent";
        const ANSWERED = "ask-dev acr token store refresh answered";
        const CLEARED = "ask-dev acr token store family cleared";
        const PRINCIPAL = "ask-dev acr token store principal dropped";
        const RACE = "ask-dev acr token store clear overtook";
        const CLONE = "ask-dev acr token store clone dropped";
        const RECEIVED = "ask-dev acr token store clear received";
        const ATTEMPT = "ask-dev acr token store authorization";

        /** What the store logged since `mark`: [level, message, fields], in order. */
        function since(mark: number) {
            return sink
                .slice(mark)
                .filter(({ args }) => String(args[1]).startsWith("ask-dev acr token store"))
                .map(({ level, args }) => [level, args[1], args[0]] as const);
        }

        it("a refresh that works: sent and answered ok, both Info", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            const mark = sink.length;
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["info", ANSWERED, { family_id: id, outcome: "ok", status: 200 }],
            ]);
        });

        it("serving the held token logs nothing", async () => {
            await signIn();
            const mark = sink.length;
            for (let i = 0; i < 3; i += 1) {
                expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            }
            expect(sink.slice(mark)).toEqual([]);
        });

        it("a refused refresh: answered refused with its status, and the family cleared", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver: 401 }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "refused", status: 401 }],
                ["warn", CLEARED, { family_id: id, reason: "refused" }],
            ]);
        });

        it("a lost response 25 s after the attempt: lost, no retry, cleared past_grace", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver: "network", elapse: 25_000 }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "lost" }],
                ["warn", CLEARED, { family_id: id, reason: "past_grace" }],
            ]);
        });

        it.each([429, 403, 404])(
            "a received %d is not lost: answered unexpected_status, retried as before (codex r1 on #1681)",
            async (status) => {
                await signIn();
                const id = storedFamily()!.familyId;
                now += REFRESH_AT_MS;
                fates = [{ deliver: status }];
                const mark = sink.length;
                expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
                expect(since(mark).slice(0, 3)).toEqual([
                    ["info", SENT, { family_id: id, attempt: 1 }],
                    ["warn", ANSWERED, { family_id: id, outcome: "unexpected_status", status }],
                    ["info", SENT, { family_id: id, attempt: 2 }],
                ]);
            },
        );

        it("a 5xx is lost, with its status", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver: 503 }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(since(mark)[1]).toEqual([
                "warn",
                ANSWERED,
                { family_id: id, outcome: "lost", status: 503 },
            ]);
        });

        it("a lost response, then a failed retry: attempt 2 is logged, cleared retry_failed", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver: "network" }, { deliver: 503 }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "lost" }],
                ["info", SENT, { family_id: id, attempt: 2 }],
                ["warn", ANSWERED, { family_id: id, outcome: "lost", status: 503 }],
                ["warn", CLEARED, { family_id: id, reason: "retry_failed" }],
            ]);
        });

        it("a lost response, then a retry that works: two sends, no clear", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver: "network" }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toMatchObject({ kind: "token" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "lost" }],
                ["info", SENT, { family_id: id, attempt: 2 }],
                ["info", ANSWERED, { family_id: id, outcome: "ok", status: 200 }],
            ]);
        });

        it.each([
            [
                "a malformed token answer",
                (body: Record<string, unknown>) => ({ ...body, access_token: "x" }),
            ],
            [
                "an answer with no new refresh token",
                (body: Record<string, unknown>) => ({ ...body, refresh_token: undefined }),
            ],
        ])("%s: answered invalid, cleared invalid", async (_, deliver) => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ deliver }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "invalid", status: 200 }],
                ["warn", CLEARED, { family_id: id, reason: "invalid" }],
            ]);
        });

        it("a clear that lands while the refresh runs: answered overtaken, and the race logged", async () => {
            await signIn();
            const id = storedFamily()!.familyId;
            now += REFRESH_AT_MS;
            fates = [{ during: async () => defaultTab.clearAcrTokensInAllTabs() }];
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["info", SENT, { family_id: id, attempt: 1 }],
                ["warn", ANSWERED, { family_id: id, outcome: "overtaken", status: 200 }],
                ["warn", RACE, { where: "refresh" }],
            ]);
        });

        it.each([
            ["a user switch", { userId: "user-2", orgId: "org-1" }, "mismatch"],
            ["an org switch", { userId: "user-1", orgId: "org-2" }, "mismatch"],
            ["no session", null, "no_session"],
            ["an impersonating session", IMPERSONATING, "impersonating"],
        ] as const)(
            "%s before the token is served: dropped, check before",
            async (_, next, reason) => {
                await signIn();
                principal = next;
                const mark = sink.length;
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(since(mark)).toEqual([["warn", PRINCIPAL, { check: "before", reason }]]);
            },
        );

        it("a stored family of another user: dropped as a mismatch, check before", async () => {
            storage.setItem(
                ACR_TOKEN_FAMILY_KEY,
                JSON.stringify({ ...STORED_FAMILY, userId: "user-2" }),
            );
            const { auth } = await openTab(storage);
            const mark = sink.length;
            expect(await auth.getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["warn", PRINCIPAL, { check: "before", reason: "mismatch" }],
            ]);
        });

        it("the family changes owner while the call waits for the lock: check lock", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                lock: (name, task) => {
                    storage.setItem(
                        ACR_TOKEN_FAMILY_KEY,
                        JSON.stringify({ ...storedFamily(), userId: "user-2" }),
                    );
                    return locks.lock(name, task);
                },
            });
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark)).toEqual([
                ["warn", PRINCIPAL, { check: "lock", reason: "mismatch" }],
            ]);
        });

        it.each([
            ["no session", null, "no_session"],
            ["another org", { userId: "user-1", orgId: "org-2" }, "mismatch"],
            ["an impersonating session", IMPERSONATING, "impersonating"],
        ] as const)(
            "%s after the refresh: dropped, check after_refresh",
            async (_, next, reason) => {
                await signIn();
                now += REFRESH_AT_MS;
                let reads = 0;
                setAcrAuthDependenciesForTest({
                    ...depsFor(storage),
                    principal: async () => {
                        reads += 1;
                        return reads === 2 ? next : principal;
                    },
                });
                const mark = sink.length;
                expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
                expect(reads).toBe(2);
                expect(since(mark).filter(([, message]) => message === PRINCIPAL)).toEqual([
                    ["warn", PRINCIPAL, { check: "after_refresh", reason }],
                ]);
            },
        );

        it("a clear while the principal is read after a refresh: the race, where after_refresh_check", async () => {
            await signIn();
            now += REFRESH_AT_MS;
            let reads = 0;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    reads += 1;
                    if (reads === 2) defaultTab.clearAcrTokensInAllTabs();
                    return principal;
                },
            });
            const mark = sink.length;
            expect(await getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark).filter(([, message]) => message === RACE)).toEqual([
                ["warn", RACE, { where: "after_refresh_check" }],
            ]);
        });

        /** The lines of this attempt, past its own one-line end. */
        const withoutEnd = (lines: ReturnType<typeof since>) =>
            lines.filter(([, message]) => message !== ATTEMPT);

        it("every attempt ends in one line, an enum and no more", async () => {
            const mark = sink.length;
            await signIn();
            expect(since(mark).filter(([, message]) => message === ATTEMPT)).toEqual([
                ["info", ATTEMPT, { outcome: "authorized" }],
            ]);
        });

        it("a failed attempt names its end at Warn", async () => {
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                fetch: () => Promise.reject(new TypeError("Failed to fetch")),
            });
            const mark = sink.length;
            await defaultTab.authorizeAcrSilently();
            expect(since(mark)).toEqual([
                ["warn", ATTEMPT, { outcome: "failed", reason: "unavailable" }],
            ]);
        });

        it("an impersonating start: dropped, check begin", async () => {
            principal = IMPERSONATING;
            const mark = sink.length;
            expect(await defaultTab.authorizeAcrSilently()).toEqual({ kind: "impersonating" });
            expect(withoutEnd(since(mark))).toEqual([
                ["warn", PRINCIPAL, { check: "begin", reason: "impersonating" }],
            ]);
        });

        it.each([
            ["no session", null, "no_session"],
            ["an impersonating session", IMPERSONATING, "impersonating"],
            ["another user", { userId: "user-2", orgId: "org-1" }, "mismatch"],
        ] as const)("%s at the exchange: check exchange_before", async (_, next, reason) => {
            let reads = 0;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    reads += 1;
                    return reads === 1 ? principal : next;
                },
            });
            const mark = sink.length;
            await defaultTab.authorizeAcrSilently();
            expect(withoutEnd(since(mark))).toEqual([
                ["warn", PRINCIPAL, { check: "exchange_before", reason }],
            ]);
        });

        it.each([
            ["no session", null, "no_session"],
            ["another user", { userId: "user-2", orgId: "org-1" }, "mismatch"],
            ["an impersonating session", IMPERSONATING, "impersonating"],
        ] as const)(
            "%s by the end of the code exchange: check exchange_after",
            async (_, next, reason) => {
                fates.push({
                    during: async () => {
                        principal = next;
                    },
                });
                const mark = sink.length;
                await defaultTab.authorizeAcrSilently();
                expect(withoutEnd(since(mark))).toEqual([
                    ["warn", PRINCIPAL, { check: "exchange_after", reason }],
                ]);
            },
        );

        it("a clear while the code exchange runs: the race, where exchange", async () => {
            fates.push({ during: async () => defaultTab.clearAcrTokensInAllTabs() });
            const mark = sink.length;
            expect(await defaultTab.authorizeAcrSilently()).toMatchObject({
                kind: "failed",
                reason: "signed_out",
            });
            expect(withoutEnd(since(mark))).toEqual([["warn", RACE, { where: "exchange" }]]);
        });

        it("a clear before the code exchange starts is the same race: where exchange (codex r2 on #1681)", async () => {
            let reads = 0;
            setAcrAuthDependenciesForTest({
                ...depsFor(storage),
                principal: async () => {
                    reads += 1;
                    if (reads === 2) defaultTab.clearAcrTokensInAllTabs();
                    return principal;
                },
            });
            const mark = sink.length;
            expect(await defaultTab.authorizeAcrSilently()).toMatchObject({
                kind: "failed",
                reason: "signed_out",
            });
            expect(withoutEnd(since(mark))).toEqual([["warn", RACE, { where: "exchange" }]]);
        });

        it.each([
            ["with a copied family", true],
            ["with no family to drop", false],
        ])("a cloned tab %s: one line with dropped_family", async (_, withFamily) => {
            const hub = channelHub();
            const original = await openTab(storage, hub.join());
            await signIn(original.auth);
            const clone = duplicate(storage);
            if (!withFamily) clone.removeItem(ACR_TOKEN_FAMILY_KEY);
            const copy = await openTab(clone, hub.join());
            const mark = sink.length;
            expect(await copy.auth.getAcrAccessToken()).toEqual({ kind: "authorization_required" });
            expect(since(mark).filter(([, message]) => message === CLONE)).toEqual([
                ["info", CLONE, { dropped_family: withFamily }],
            ]);
        });

        it("a clear from another tab: one Info line on the tab that received it, none on the sender", async () => {
            const hub = channelHub();
            const here = await openTab(storage, hub.join());
            await signIn(here.auth);
            const there = await openTab(new MemoryStorage(), hub.join());
            await signIn(there.auth);
            const mark = sink.length;
            here.auth.clearAcrTokensInAllTabs();
            await turns(2);
            expect(since(mark)).toEqual([["info", RECEIVED, { source: "other_tab" }]]);
        });
    });
});

describe("module load (P1-6, CHAOS-12305)", () => {
    /** The browser's BroadcastChannel, in memory: delivers to every other open channel, later. */
    class FakeBroadcastChannel {
        static open: FakeBroadcastChannel[] = [];
        private readonly listeners: ((event: { data: unknown }) => void)[] = [];
        constructor(readonly name: string) {
            FakeBroadcastChannel.open.push(this);
        }
        postMessage(data: unknown) {
            for (const other of FakeBroadcastChannel.open) {
                if (other === this || other.name !== this.name) continue;
                for (const listener of other.listeners) {
                    queueMicrotask(() => listener({ data: structuredClone(data) }));
                }
            }
        }
        addEventListener(type: string, listener: (event: { data: unknown }) => void) {
            if (type === "message") this.listeners.push(listener);
        }
        close() {}
    }

    it("sends no request when the store loads; listenForAcrTabs, which a host calls on every page, starts the tab listener", async () => {
        const fetchSpy = vi.fn(async () => json(200, {}));
        vi.stubGlobal("fetch", fetchSpy);
        FakeBroadcastChannel.open = [];
        vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
        const tab = new MemoryStorage();
        tab.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(STORED_FAMILY));
        vi.stubGlobal("window", {
            sessionStorage: tab,
            location: { origin: WEB },
        });
        vi.resetModules();
        const auth = await import("../auth");
        auth.configureAcrAuth({ config: () => CONFIG, session: getSession, routes: ROUTES });
        // The store listens lazily, on its first use.
        expect(FakeBroadcastChannel.open).toHaveLength(0);
        auth.listenForAcrTabs();
        await turns(2);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(getSession).not.toHaveBeenCalled();
        expect(FakeBroadcastChannel.open.map((channel) => channel.name)).toEqual([
            ACR_TABS_CHANNEL,
        ]);

        // A sign-out in another tab reaches this page, which never used the store.
        new FakeBroadcastChannel(ACR_TABS_CHANNEL).postMessage({ type: "clear" });
        await turns(2);
        expect(tab.getItem(ACR_TOKEN_FAMILY_KEY)).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

/**
 * CHAOS-12369: the guard. It reads every log call made by every test of this file, so a log line
 * that leaks a token, a code, a verifier, a state or a tab id fails here, whichever test drove it.
 * Run the whole file: a filtered run sees too few calls and fails the first test on purpose.
 */
describe("no secret in any log call (CHAOS-12369)", () => {
    it("saw the store's events and the secrets (a guard that sees nothing must fail)", () => {
        const messages = new Set(sink.map(({ args }) => String(args[1])));
        for (const message of [
            "ask-dev acr token store refresh sent",
            "ask-dev acr token store refresh answered",
            "ask-dev acr token store family cleared",
            "ask-dev acr token store principal dropped",
            "ask-dev acr token store clear overtook",
            "ask-dev acr token store clone dropped",
            "ask-dev acr token store clear received",
            "ask-dev acr token store authorization",
        ]) {
            expect(messages).toContain(message);
        }
        // Every kind was harvested, with a value long enough for the guard below to look for it
        // (codex r1 on #1681: a total count hid a kind that was never harvested).
        for (const [kind, values] of Object.entries(secretsByKind)) {
            expect(
                [...values].some((value) => value.length >= 8),
                `no ${kind} value was harvested`,
            ).toBe(true);
        }
    });

    it("no log argument holds a token, an authorization code, a verifier, a state or a tab id", () => {
        const text = JSON.stringify(sink.map(({ args }) => args));
        expect(text).not.toMatch(/fcacr_|acrrt_/u);
        for (const [kind, values] of Object.entries(secretsByKind)) {
            for (const value of values) {
                if (value.length < 8) continue;
                expect(text, `a log call carries a ${kind} value`).not.toContain(value);
            }
        }
    });
});
