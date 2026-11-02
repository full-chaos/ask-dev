import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcrBrowserClientConfig } from "../config";

/**
 * CHAOS-12106: the redirect path, for a host with no session route. Each test takes a new copy of
 * the modules: the token store holds one host per page.
 */
const ISSUER = "http://localhost:8088";
const CONFIG: AcrBrowserClientConfig = {
    issuer: ISSUER,
    webOrigin: "http://localhost:3021",
    clientId: "https://localhost/acr/dev-browser-client",
    redirectUri: "http://localhost:3021/oauth/callback",
    usesMetadataDocument: false,
};
const METADATA = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    revocation_endpoint: `${ISSUER}/revoke`,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
};
const ACCESS = `fcacr_${"A".repeat(43)}`;
const REFRESH = `acrrt_${"R".repeat(43)}`;
const KEY = "ask-dev:acr-authorization";
const FIXED = { user: { id: "workbench" } };

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

let tokenBodies: URLSearchParams[];
let tokenAnswer: () => Response;
let navigated: string[];

function stubFetch(metadata: Response | null = json(METADATA)): void {
    tokenBodies = [];
    tokenAnswer = () =>
        json({
            access_token: ACCESS,
            token_type: "Bearer",
            expires_in: 600,
            refresh_token: REFRESH,
        });
    vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.endsWith("/.well-known/oauth-authorization-server")) {
                return metadata === null
                    ? Promise.reject(new Error("no answer"))
                    : Promise.resolve(metadata);
            }
            if (url === `${ISSUER}/token`) {
                tokenBodies.push(init?.body as URLSearchParams);
                return Promise.resolve(tokenAnswer());
            }
            return Promise.reject(new Error(`no answer for ${url}`));
        }),
    );
}

async function store(session: () => Promise<unknown> = () => Promise.resolve(FIXED)) {
    const auth = await import("../auth");
    auth.configureAcrAuth({
        config: () => CONFIG,
        session: session as never,
        routes: null,
    });
    auth.setAcrAuthDependenciesForTest({ navigate: (url) => navigated.push(url) });
    return auth;
}

/** Starts, and gives what ACR would put on the callback for that start. */
async function started(auth: Awaited<ReturnType<typeof store>>) {
    await expect(auth.beginAcrRedirect()).resolves.toEqual({ kind: "redirected" });
    const url = new URL(navigated[0]!);
    return { url, state: url.searchParams.get("state")! };
}

beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    navigated = [];
    stubFetch();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("beginAcrRedirect", () => {
    it("sends the tab to ACR with the exact request, and no verifier", async () => {
        const auth = await store();
        const { url, state } = await started(auth);
        expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            response_type: "code",
            client_id: CONFIG.clientId,
            redirect_uri: CONFIG.redirectUri,
            code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) as string,
            code_challenge_method: "S256",
            state,
            resource: ISSUER,
            scope: "context:read evidence:read",
        });
        const pending = JSON.parse(window.sessionStorage.getItem(KEY)!) as { verifier: string };
        expect(navigated[0]).not.toContain(pending.verifier);
        expect(url.searchParams.get("code_challenge")).toBe(
            await auth.pkceChallenge(pending.verifier),
        );
    });

    it("is off with no client, and sends nothing", async () => {
        const auth = await import("../auth");
        auth.setAcrAuthDependenciesForTest({ navigate: (url) => navigated.push(url) });
        await expect(auth.beginAcrRedirect()).resolves.toEqual({ kind: "off" });
        expect(navigated).toEqual([]);
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it("stays when ACR's metadata does not answer", async () => {
        stubFetch(null);
        const auth = await store();
        await expect(auth.beginAcrRedirect()).resolves.toEqual({
            kind: "failed",
            reason: "unavailable",
        });
        expect(navigated).toEqual([]);
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it("gives an impersonating session no start", async () => {
        const auth = await store(() =>
            Promise.resolve({ user: { id: "workbench", is_impersonating: true } }),
        );
        await expect(auth.beginAcrRedirect()).resolves.toEqual({ kind: "impersonating" });
        expect(navigated).toEqual([]);
    });

    it("gives a session it cannot read no start", async () => {
        const auth = await store(() => Promise.resolve(null));
        await expect(auth.beginAcrRedirect()).resolves.toEqual({
            kind: "failed",
            reason: "principal_unknown",
        });
        expect(navigated).toEqual([]);
    });
});

describe("completeAcrRedirect", () => {
    const query = (fields: Record<string, string>) => `?${new URLSearchParams(fields).toString()}`;

    it("exchanges the code once, with the verifier, and holds the token", async () => {
        const auth = await store();
        const { state } = await started(auth);
        const pending = JSON.parse(window.sessionStorage.getItem(KEY)!) as { verifier: string };
        await expect(
            auth.completeAcrRedirect(query({ code: "the-code", state, iss: ISSUER })),
        ).resolves.toEqual({ kind: "token", token: ACCESS, issuer: ISSUER });
        expect(tokenBodies).toHaveLength(1);
        expect(Object.fromEntries(tokenBodies[0]!)).toEqual({
            grant_type: "authorization_code",
            code: "the-code",
            redirect_uri: CONFIG.redirectUri,
            client_id: CONFIG.clientId,
            code_verifier: pending.verifier,
            resource: ISSUER,
        });
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
        await expect(auth.getAcrAccessToken()).resolves.toMatchObject({ token: ACCESS });
        expect(auth.readAcrHeldFamily()?.refreshToken).toBe(REFRESH);
    });

    it("is single use: a second callback sends nothing", async () => {
        const auth = await store();
        const { state } = await started(auth);
        const callback = query({ code: "the-code", state, iss: ISSUER });
        await auth.completeAcrRedirect(callback);
        await expect(auth.completeAcrRedirect(callback)).resolves.toEqual({
            kind: "failed",
            reason: "expired",
        });
        expect(tokenBodies).toHaveLength(1);
    });

    it.each([
        ["a wrong state", { state: "x".repeat(43), iss: ISSUER }, "state_mismatch"],
        ["a wrong issuer", { iss: "http://localhost:9999" }, "iss_mismatch"],
        ["no issuer", { iss: "" }, "iss_mismatch"],
    ])("refuses %s, and sends no code", async (_name, fields, reason) => {
        const auth = await store();
        const { state } = await started(auth);
        await expect(
            auth.completeAcrRedirect(query({ code: "the-code", state, ...fields })),
        ).resolves.toEqual({ kind: "failed", reason });
        expect(tokenBodies).toEqual([]);
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it.each([
        ["a denial", { error: "access_denied", code: "the-code" }],
        ["no code", {}],
        ["an empty code", { code: "" }],
    ])("refuses %s, and sends no code", async (_name, fields) => {
        const auth = await store();
        const { state } = await started(auth);
        await expect(
            auth.completeAcrRedirect(query({ state, iss: ISSUER, ...fields })),
        ).resolves.toEqual({ kind: "failed", reason: "refused" });
        expect(tokenBodies).toEqual([]);
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it("refuses a callback with no start", async () => {
        const auth = await store();
        await expect(auth.completeAcrRedirect(query({ code: "c", state: "s" }))).resolves.toEqual({
            kind: "failed",
            reason: "expired",
        });
        expect(tokenBodies).toEqual([]);
    });

    it.each([
        ["no state", (entry: Record<string, unknown>) => ({ ...entry, state: undefined })],
        ["no verifier", (entry: Record<string, unknown>) => ({ ...entry, verifier: 7 })],
        ["no expiry", (entry: Record<string, unknown>) => ({ ...entry, expiresAt: "soon" })],
        [
            "a bad revoke url",
            (entry: Record<string, unknown>) => ({ ...entry, revocationEndpoint: 1 }),
        ],
        ["no asker", (entry: Record<string, unknown>) => ({ ...entry, askedBy: null })],
        [
            "a bad asker",
            (entry: Record<string, unknown>) => ({ ...entry, askedBy: { userId: 1, orgId: null } }),
        ],
        [
            "a bad org",
            (entry: Record<string, unknown>) => ({ ...entry, askedBy: { userId: "u", orgId: 1 } }),
        ],
    ])("reads an entry with %s as no start", async (_name, broken) => {
        const auth = await store();
        const { state } = await started(auth);
        const entry = JSON.parse(window.sessionStorage.getItem(KEY)!) as Record<string, unknown>;
        window.sessionStorage.setItem(KEY, JSON.stringify(broken(entry)));
        await expect(
            auth.completeAcrRedirect(query({ code: "the-code", state, iss: ISSUER })),
        ).resolves.toEqual({ kind: "failed", reason: "expired" });
        expect(tokenBodies).toEqual([]);
    });

    it("refuses a start that has expired", async () => {
        const auth = await store();
        let now = 1_000;
        auth.setAcrAuthDependenciesForTest({
            navigate: (url) => navigated.push(url),
            now: () => now,
        });
        const { state } = await started(auth);
        now += auth.ACR_AUTHORIZATION_TTL_MS + 1;
        await expect(
            auth.completeAcrRedirect(query({ code: "the-code", state, iss: ISSUER })),
        ).resolves.toEqual({ kind: "failed", reason: "expired" });
        expect(tokenBodies).toEqual([]);
    });

    it("binds the code to the principal that asked", async () => {
        let session: unknown = FIXED;
        const auth = await store(() => Promise.resolve(session));
        const { state } = await started(auth);
        session = { user: { id: "someone-else" } };
        await expect(
            auth.completeAcrRedirect(query({ code: "the-code", state, iss: ISSUER })),
        ).resolves.toEqual({ kind: "failed", reason: "signed_out" });
        expect(tokenBodies).toEqual([]);
    });

    it("is off with no client", async () => {
        const auth = await import("../auth");
        await expect(auth.completeAcrRedirect("?code=c")).resolves.toEqual({ kind: "off" });
    });
});

describe("a clear", () => {
    it("drops a pending start with the tokens", async () => {
        const auth = await store();
        await started(auth);
        expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
        auth.clearAcrTokensInAllTabs();
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });
});

describe("a host with no routes", () => {
    it("has no silent step", async () => {
        const auth = await store();
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "off" });
    });
});
