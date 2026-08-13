import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signWebAssertion, type WebAssertionConfig } from "@/lib/acr/assertion";

const { privateKey } = generateKeyPairSync("ed25519");

const config: WebAssertionConfig = {
    audience: "dev-health-acr",
    issuer: "dev-health-web",
    keyId: "acr-dev-web",
};

function baseInput() {
    return {
        body: JSON.stringify({ question: "status?" }),
        config,
        method: "POST" as const,
        orgId: "70d529e0-3c06-4597-8480-794fd02328b6",
        path: "/api/v1/context-fabric/investigations",
        permissions: ["context:read"] as const,
        privateKey,
        repositoryScopes: ["full.chaos/dev-health-ops"],
        subject: "context-fabric-workbench",
    };
}

function decodeClaims(assertion: string): Record<string, unknown> {
    const claims = assertion.split(".")[1];
    return JSON.parse(Buffer.from(claims!, "base64url").toString("utf8")) as Record<
        string,
        unknown
    >;
}

describe("signWebAssertion", () => {
    it("produces a verifiable EdDSA compact JWT", () => {
        const assertion = signWebAssertion(baseInput());
        const [header, claims, signature] = assertion.split(".");

        expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({
            alg: "EdDSA",
            kid: "acr-dev-web",
            typ: "JWT",
        });
        expect(
            verify(
                null,
                Buffer.from(`${header}.${claims}`, "utf8"),
                createPublicKey(privateKey),
                Buffer.from(signature!, "base64url"),
            ),
        ).toBe(true);
    });

    it("binds the claim set to method, path, and body digest", () => {
        const claims = decodeClaims(signWebAssertion(baseInput()));

        expect(claims["method"]).toBe("POST");
        expect(claims["path"]).toBe("/api/v1/context-fabric/investigations");
        // ACR recomputes this over the exact bytes it receives, so a changed
        // body must change the digest.
        const other = decodeClaims(signWebAssertion({ ...baseInput(), body: "{}" }));
        expect(other["body_sha256"]).not.toBe(claims["body_sha256"]);
    });

    it("keeps the lifetime inside ACR's 30-second cap", () => {
        const claims = decodeClaims(signWebAssertion({ ...baseInput(), now: 1_000_000 }));

        expect(claims["iat"]).toBe(1_000_000);
        expect(claims["nbf"]).toBe(1_000_000);
        expect(claims["exp"]).toBe(1_000_030);
        expect((claims["exp"] as number) - (claims["iat"] as number)).toBeLessThanOrEqual(30);
    });

    /**
     * The regression this repo exists to not repeat. ACR answers an assertion
     * with empty `repository_scopes` with a bare 401 `invalid_token` that says
     * nothing about scopes; this guard turns it into a local, named error.
     */
    it("refuses to sign an assertion with no repository scopes", () => {
        expect(() => signWebAssertion({ ...baseInput(), repositoryScopes: [] })).toThrow(
            /empty repository_scopes/,
        );
    });

    it("carries the org, subject, permissions, and scopes through unchanged", () => {
        const claims = decodeClaims(
            signWebAssertion({
                ...baseInput(),
                permissions: ["context:read", "evidence:read"],
                repositoryScopes: ["full.chaos/dev-health-ops", "full.chaos/chaos-ops"],
            }),
        );

        expect(claims["org_id"]).toBe("70d529e0-3c06-4597-8480-794fd02328b6");
        expect(claims["sub"]).toBe("context-fabric-workbench");
        expect(claims["aud"]).toBe("dev-health-acr");
        expect(claims["iss"]).toBe("dev-health-web");
        expect(claims["permissions"]).toEqual(["context:read", "evidence:read"]);
        expect(claims["repository_scopes"]).toEqual([
            "full.chaos/dev-health-ops",
            "full.chaos/chaos-ops",
        ]);
    });

    it("uses a fresh jti per assertion so ACR's replay guard is not tripped", () => {
        const first = decodeClaims(signWebAssertion(baseInput()));
        const second = decodeClaims(signWebAssertion(baseInput()));

        expect(first["jti"]).not.toBe(second["jti"]);
    });
});

describe("signing key handling", () => {
    it("accepts the PEM form compose provisions for dev", () => {
        const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
        expect(() =>
            signWebAssertion({ ...baseInput(), privateKey: createPrivateKey(pem) }),
        ).not.toThrow();
    });
});
