import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * CHAOS-12106: the host through the real token store. The Workbench has no session of its own, so
 * a start needs its fixed principal: a host with none gets no redirect.
 */
const ISSUER = "http://localhost:8088";

beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_ACR_OAUTH_ISSUER", ISSUER);
    vi.stubGlobal(
        "fetch",
        vi.fn(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        issuer: ISSUER,
                        authorization_endpoint: `${ISSUER}/authorize`,
                        token_endpoint: `${ISSUER}/token`,
                        code_challenge_methods_supported: ["S256"],
                        authorization_response_iss_parameter_supported: true,
                    }),
                    { status: 200 },
                ),
            ),
        ),
    );
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

it("starts the redirect on the Workbench's own client, with no session route", async () => {
    const host = await import("./browser-host");
    const client = await import("@/acr-client");
    const navigated: string[] = [];
    client.setAcrAuthDependenciesForTest({ navigate: (url) => navigated.push(url) });
    await expect(host.authorizeByRedirect()).resolves.toEqual({ kind: "off" });
    const url = new URL(navigated[0]!);
    expect(url.origin).toBe(ISSUER);
    expect(url.searchParams.get("client_id")).toBe("https://localhost/acr/dev-browser-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/oauth/callback`);
    await expect(client.authorizeAcrSilently()).resolves.toEqual({ kind: "off" });
});
