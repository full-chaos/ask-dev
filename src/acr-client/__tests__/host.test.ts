import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcrBrowserClientConfig } from "../config";

/**
 * CHAOS-12540: what a host gives the client reaches it. Each test takes a new copy of the modules:
 * the token store holds one host per page.
 */
const ISSUER = "https://acr.example.test";
const CONFIG: AcrBrowserClientConfig = {
    issuer: ISSUER,
    webOrigin: "https://host.example.test",
    clientId: "https://host.example.test/client.json",
    redirectUri: "https://host.example.test/callback",
    usesMetadataDocument: true,
};
const ROUTES = { authorize: "/host/authorize", session: "/host/session" };
const METADATA = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
};
const SIGNED_IN = { user: { id: "user-1", org_id: "org-1" } };

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

let calls: string[];
/** ACR's metadata, a host route that refuses, and a session route. */
function stubFetch(sessionAnswer: unknown): void {
    calls = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.endsWith("/.well-known/oauth-authorization-server")) {
                return Promise.resolve(json(METADATA));
            }
            if (url === ROUTES.authorize) {
                return Promise.resolve(json({ error: { code: "not_entitled" } }, 403));
            }
            if (url === ROUTES.session) return Promise.resolve(json(sessionAnswer));
            return Promise.reject(new Error(`no answer for ${url}`));
        }),
    );
}

beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the token store's host", () => {
    it("is off with no host, and sends nothing", async () => {
        stubFetch({});
        const auth = await import("../auth");
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "off" });
        expect(calls).toEqual([]);
    });

    it("reads the host's session and asks the host's route", async () => {
        stubFetch({});
        const auth = await import("../auth");
        const session = vi.fn(() => Promise.resolve(SIGNED_IN));
        auth.configureAcrAuth({ config: () => CONFIG, session, routes: ROUTES });
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "not_entitled" });
        expect(session).toHaveBeenCalled();
        expect(calls).toContain(ROUTES.authorize);
        expect(calls).not.toContain(ROUTES.session);
    });

    it("asks the host's session route when the session reads as none", async () => {
        stubFetch({});
        const auth = await import("../auth");
        auth.configureAcrAuth({
            config: () => CONFIG,
            session: () => Promise.resolve(null),
            routes: ROUTES,
        });
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "session_ended" });
        expect(calls).toEqual([ROUTES.session]);
    });

    it("reads a session read that rejects as no session", async () => {
        stubFetch(SIGNED_IN);
        const auth = await import("../auth");
        auth.configureAcrAuth({
            config: () => CONFIG,
            session: () => Promise.reject(new Error("the read failed")),
            routes: ROUTES,
        });
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({
            kind: "failed",
            reason: "principal_unknown",
        });
    });

    it.each([7, true, ["org-1"], { id: "org-1" }])(
        "reads an org id of %j as no known principal",
        async (orgId) => {
            stubFetch(SIGNED_IN);
            const auth = await import("../auth");
            auth.configureAcrAuth({
                config: () => CONFIG,
                session: () => Promise.resolve({ user: { id: "user-1", org_id: orgId } }),
                routes: ROUTES,
            });
            await expect(auth.authorizeAcrSilently()).resolves.toEqual({
                kind: "failed",
                reason: "principal_unknown",
            });
            expect(calls).not.toContain(ROUTES.authorize);
        },
    );

    it.each([null, undefined, ""])("reads an org id of %j as no organization", async (orgId) => {
        stubFetch({});
        const auth = await import("../auth");
        auth.configureAcrAuth({
            config: () => CONFIG,
            session: () => Promise.resolve({ user: { id: "user-1", org_id: orgId } }),
            routes: ROUTES,
        });
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "not_entitled" });
    });

    it("keeps the host through the test seam and its reset", async () => {
        stubFetch({});
        const auth = await import("../auth");
        auth.configureAcrAuth({
            config: () => CONFIG,
            session: () => Promise.resolve(SIGNED_IN),
            routes: ROUTES,
        });
        auth.setAcrAuthDependenciesForTest({ now: () => 1 });
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "not_entitled" });
        calls.length = 0;
        auth.setAcrAuthDependenciesForTest();
        await expect(auth.authorizeAcrSilently()).resolves.toEqual({ kind: "not_entitled" });
        expect(calls).toContain(ROUTES.authorize);
    });
});

describe("the log sink", () => {
    it("drops a line with no host sink", async () => {
        const { logger } = await import("../logger");
        expect(() => logger.warn({ reason: "none" }, "a line")).not.toThrow();
    });

    it("sends each level to the host's sink", async () => {
        const { logger, setAcrLogger } = await import("../logger");
        const info = vi.fn();
        const warn = vi.fn();
        setAcrLogger({ info, warn });
        logger.info({ a: 1 }, "info line");
        logger.warn({ b: 2 }, "warn line");
        expect(info).toHaveBeenCalledExactlyOnceWith({ a: 1 }, "info line");
        expect(warn).toHaveBeenCalledExactlyOnceWith({ b: 2 }, "warn line");
    });
});
