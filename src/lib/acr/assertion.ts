import "server-only";

import { createHash, randomUUID, sign, type KeyObject } from "node:crypto";

/**
 * Signs the Ed25519 web assertion ACR requires for read-only server-to-server
 * requests (`X-ACR-Web-Assertion`).
 *
 * Mirrors dev-health-web's `src/lib/acr/assertion.ts` deliberately: this module
 * is expected to migrate into that repo, and any divergence between the two
 * signers is a bug waiting to happen.
 *
 * This file is `server-only` and must stay that way. The assertion is signed
 * with a PRIVATE key; a browser cannot hold one, which is exactly why the
 * Workbench needs a server hop at all rather than calling ACR from the client.
 */

export type AssertionPermission = "context:read" | "credential:issue" | "evidence:read";

export type WebAssertionConfig = {
    readonly audience: string;
    readonly issuer: string;
    readonly keyId: string;
};

export type WebAssertionInput = {
    readonly body: string;
    readonly config: WebAssertionConfig;
    readonly method: "GET" | "POST";
    readonly now?: number;
    readonly orgId: string;
    readonly path: string;
    readonly permissions: readonly AssertionPermission[];
    readonly privateKey: KeyObject;
    readonly repositoryScopes: readonly string[];
    readonly subject: string;
};

function encodeCompactJson(value: object): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function bodySha256(body: string): string {
    return createHash("sha256").update(body, "utf8").digest("base64url");
}

/**
 * ACR REJECTS AN EMPTY `repository_scopes` ARRAY.
 *
 * `validWebRepositories` in acr `internal/auth/web_assertion_binding.go:34-37`
 * opens with `if len(scopes) == 0 { return false }`, and the whole assertion
 * then fails as `invalid_web_assertion` — surfacing to the caller as a bare
 * 401 `invalid_token` with no indication that scopes were the problem.
 *
 * This cost a debugging round on the first real call (CHAOS-3738 M2). It is not
 * documented in the OpenAPI security scheme, and dev-health-web never trips it
 * because its scopes always come from a resolved org authorization. Any new ACR
 * consumer will hit it. Guarding here turns a confusing 401 into a precise
 * local error.
 *
 * Left as an observation, not a patch: acr is not this repo's to change, and
 * fail-closed on an empty scope set may well be deliberate.
 */
function assertScopesPresent(repositoryScopes: readonly string[]): void {
    if (repositoryScopes.length === 0) {
        throw new Error(
            "ACR rejects an assertion with empty repository_scopes (401 invalid_token). Supply at least one repository slug.",
        );
    }
}

export function signWebAssertion(input: WebAssertionInput): string {
    assertScopesPresent(input.repositoryScopes);
    const issuedAt = input.now ?? Math.floor(Date.now() / 1_000);
    const header = encodeCompactJson({ alg: "EdDSA", kid: input.config.keyId, typ: "JWT" });
    const claims = encodeCompactJson({
        aud: input.config.audience,
        body_sha256: bodySha256(input.body),
        // ACR caps the assertion lifetime at 30 seconds and binds the claim set
        // to this exact method, path, and body digest.
        exp: issuedAt + 30,
        iat: issuedAt,
        iss: input.config.issuer,
        jti: randomUUID(),
        method: input.method,
        nbf: issuedAt,
        org_id: input.orgId,
        path: input.path,
        permissions: [...input.permissions],
        repository_scopes: [...input.repositoryScopes],
        sub: input.subject,
    });
    const signingInput = `${header}.${claims}`;
    const signature = sign(null, Buffer.from(signingInput, "utf8"), input.privateKey).toString(
        "base64url",
    );
    return `${signingInput}.${signature}`;
}
