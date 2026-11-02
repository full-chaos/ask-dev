import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const begin = vi.hoisted(() => vi.fn());
vi.mock("@/acr-client", async (original) => ({
    ...(await original<typeof import("@/acr-client")>()),
    beginAcrRedirect: begin,
}));

import {
    ACR_RETURN_KEY,
    acrClientConfig,
    authorizeByRedirect,
    isInvestigationResult,
    safeReturnPath,
} from "./browser-host";

beforeEach(() => {
    window.sessionStorage.clear();
    begin.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
});

describe("safeReturnPath", () => {
    it.each(["/", "/workbench", "/a/b"])("keeps %s", (path) => {
        expect(safeReturnPath(path)).toBe(path);
    });

    it.each([
        ["a protocol-relative url", "//evil.example"],
        ["a backslash host", "/\\evil.example"],
        ["a full url", "https://evil.example/"],
        ["no slash", "workbench"],
        ["empty", ""],
        ["null", null],
        ["undefined", undefined],
    ])("refuses %s", (_name, path) => {
        expect(safeReturnPath(path)).toBeUndefined();
    });
});

describe("acrClientConfig", () => {
    it("is ACR's development client on a loopback origin", () => {
        vi.stubEnv("NEXT_PUBLIC_ACR_OAUTH_ISSUER", "http://localhost:8088");
        expect(acrClientConfig()).toEqual({
            issuer: "http://localhost:8088",
            webOrigin: window.location.origin,
            clientId: "https://localhost/acr/dev-browser-client",
            redirectUri: `${window.location.origin}/oauth/callback`,
            usesMetadataDocument: false,
        });
    });

    it("is off with no issuer", () => {
        vi.stubEnv("NEXT_PUBLIC_ACR_OAUTH_ISSUER", "");
        expect(acrClientConfig()).toBeUndefined();
    });
});

describe("authorizeByRedirect", () => {
    it("remembers the page, starts the redirect and ends the call", async () => {
        window.history.replaceState(null, "", "/workbench?secret=not-kept");
        begin.mockResolvedValue({ kind: "redirected" });
        await expect(authorizeByRedirect()).resolves.toEqual({ kind: "off" });
        expect(begin).toHaveBeenCalledTimes(1);
        expect(window.sessionStorage.getItem(ACR_RETURN_KEY)).toBe("/workbench");
    });

    it("names an impersonating session", async () => {
        begin.mockResolvedValue({ kind: "impersonating" });
        await expect(authorizeByRedirect()).resolves.toEqual({ kind: "impersonating" });
    });

    it("names a start that failed", async () => {
        begin.mockResolvedValue({ kind: "failed", reason: "unavailable" });
        await expect(authorizeByRedirect()).resolves.toEqual({
            kind: "failed",
            reason: "unavailable",
        });
    });

    it("is off with no client", async () => {
        begin.mockResolvedValue({ kind: "off" });
        await expect(authorizeByRedirect()).resolves.toEqual({ kind: "off" });
    });
});

describe("isInvestigationResult", () => {
    it.each([
        ["a versioned object", { schema_version: "v" }, true],
        ["no version", {}, false],
        ["a number version", { schema_version: 1 }, false],
        ["null", null, false],
        ["a string", "v", false],
    ])("reads %s", (_name, value, expected) => {
        expect(isInvestigationResult(value)).toBe(expected);
    });
});
