import { describe, expect, it } from "vitest";

import {
    ACR_DEV_BROWSER_CLIENT_ID,
    acrBrowserClientConfig as clientConfig,
    acrIssuerOriginForCsp,
    type AcrClientPaths,
} from "../config";

/**
 * CHAOS-12302 (c1 of the T13 split): the one place a host decides which ACR OAuth client it is.
 * ACR's rules (acr `internal/auth/oauth.go`): the issuer is an https origin (http only on a
 * loopback host) with no path; a browser client is either a client ID metadata document at an
 * https URL, or the development-only static client `https://localhost/acr/dev-browser-client`,
 * whose redirects are exact http loopback URLs.
 */

const ACR_OAUTH_CALLBACK_PATH = "/ask-dev/oauth/callback";
const ACR_CLIENT_METADATA_PATH = "/oauth/acr-client.json";
const PATHS: AcrClientPaths = {
    callback: ACR_OAUTH_CALLBACK_PATH,
    metadata: ACR_CLIENT_METADATA_PATH,
};

function acrBrowserClientConfig(issuer: string | undefined, origin: string | undefined) {
    return clientConfig(issuer, origin, PATHS);
}

describe("acrBrowserClientConfig", () => {
    it("is off without an issuer", () => {
        expect(acrBrowserClientConfig(undefined, "https://www.fullchaos.dev")).toBeUndefined();
        expect(acrBrowserClientConfig("", "https://www.fullchaos.dev")).toBeUndefined();
        expect(acrBrowserClientConfig("   ", "https://www.fullchaos.dev")).toBeUndefined();
    });

    it("serves a metadata document client on an https origin", () => {
        expect(
            acrBrowserClientConfig("https://acr.fullchaos.dev", "https://www.fullchaos.dev"),
        ).toEqual({
            issuer: "https://acr.fullchaos.dev",
            webOrigin: "https://www.fullchaos.dev",
            clientId: `https://www.fullchaos.dev${ACR_CLIENT_METADATA_PATH}`,
            redirectUri: `https://www.fullchaos.dev${ACR_OAUTH_CALLBACK_PATH}`,
            usesMetadataDocument: true,
        });
    });

    it("is off on an https origin when the host has no metadata path", () => {
        expect(
            clientConfig("https://acr.fullchaos.dev", "https://www.fullchaos.dev", {
                callback: ACR_OAUTH_CALLBACK_PATH,
            }),
        ).toBeUndefined();
    });

    it("uses the development client on an http loopback origin (kiac)", () => {
        expect(acrBrowserClientConfig("https://acr.localhost", "http://localhost:3000")).toEqual({
            issuer: "https://acr.localhost",
            webOrigin: "http://localhost:3000",
            clientId: ACR_DEV_BROWSER_CLIENT_ID,
            redirectUri: "http://localhost:3000/ask-dev/oauth/callback",
            usesMetadataDocument: false,
        });
        expect(
            acrBrowserClientConfig("https://acr.localhost", "http://127.0.0.1:3000")?.clientId,
        ).toBe(ACR_DEV_BROWSER_CLIENT_ID);
        expect(acrBrowserClientConfig("https://acr.localhost", "http://[::1]:3000")?.clientId).toBe(
            ACR_DEV_BROWSER_CLIENT_ID,
        );
    });

    it("takes the web origin from a URL with a path, as AUTH_URL may carry one", () => {
        expect(
            acrBrowserClientConfig(
                "https://acr.fullchaos.dev",
                "https://www.fullchaos.dev/api/auth",
            )?.webOrigin,
        ).toBe("https://www.fullchaos.dev");
    });

    it.each([
        ["a path", "https://acr.fullchaos.dev/oauth"],
        ["a trailing slash", "https://acr.fullchaos.dev/"],
        ["a query", "https://acr.fullchaos.dev?x=1"],
        ["a fragment", "https://acr.fullchaos.dev#x"],
        ["user info", "https://user@acr.fullchaos.dev"],
        ["http on a public host", "http://acr.fullchaos.dev"],
        ["another scheme", "ftp://acr.fullchaos.dev"],
        ["no URL", "acr.fullchaos.dev"],
        ["a wildcard host", "https://*.fullchaos.dev"],
        ["a space", "https://acr.fullchaos.dev https://evil.example"],
    ])("refuses an issuer with %s, as ACR does", (_, issuer) => {
        expect(acrBrowserClientConfig(issuer, "https://www.fullchaos.dev")).toBeUndefined();
    });

    it("allows an http issuer only on a loopback host", () => {
        expect(
            acrBrowserClientConfig("http://localhost:8800", "http://localhost:3000")?.issuer,
        ).toBe("http://localhost:8800");
    });

    it.each([
        ["no web origin", undefined],
        ["http on a public host", "http://www.fullchaos.dev"],
        ["not a URL", "www.fullchaos.dev"],
        ["user info", "https://user:pass@www.fullchaos.dev"],
    ])("is off with %s", (_, webOrigin) => {
        expect(acrBrowserClientConfig("https://acr.fullchaos.dev", webOrigin)).toBeUndefined();
    });
});

describe("acrIssuerOriginForCsp", () => {
    it("gives the issuer origin the CSP may add", () => {
        expect(acrIssuerOriginForCsp("https://acr.fullchaos.dev")).toBe(
            "https://acr.fullchaos.dev",
        );
        expect(acrIssuerOriginForCsp(" https://acr.fullchaos.dev:8443 ")).toBe(
            "https://acr.fullchaos.dev:8443",
        );
        expect(acrIssuerOriginForCsp("http://localhost:8800")).toBe("http://localhost:8800");
    });

    it.each([
        ["no issuer", undefined],
        ["an empty issuer", ""],
        ["a path", "https://acr.fullchaos.dev/oauth"],
        ["a trailing slash", "https://acr.fullchaos.dev/"],
        ["http on a public host", "http://acr.fullchaos.dev"],
        ["a wildcard host", "https://*.fullchaos.dev"],
        ["user info", "https://user@acr.fullchaos.dev"],
    ])("adds nothing for %s", (_, issuer) => {
        expect(acrIssuerOriginForCsp(issuer)).toBeUndefined();
    });
});
