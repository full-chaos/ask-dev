import "server-only";

import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Server-side ACR runtime configuration.
 *
 * Every value is read from the environment at request time. Nothing is
 * hardcoded, nothing is committed, and the signing key is referenced BY PATH
 * (`ACR_WEB_ASSERTION_KEY_FILE`) — the key material itself never enters this
 * repo, matching how compose provisions it for dev-health-web
 * (`./.acr-dev/web-assertion.key`).
 *
 * None of these are `NEXT_PUBLIC_*`, so none of them can reach the browser
 * bundle.
 */
export type AcrRuntimeConfig = {
    readonly apiOrigin: string;
    readonly audience: string;
    readonly issuer: string;
    readonly keyId: string;
    readonly orgId: string;
    readonly privateKey: KeyObject;
    readonly repositoryScopes: readonly string[];
    readonly subject: string;
    readonly timeoutMs: number;
};

export class AcrConfigError extends Error {
    override readonly name = "AcrConfigError";
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (value === undefined || value === "") {
        throw new AcrConfigError(`${name} is required`);
    }
    return value;
}

function optional(name: string, fallback: string): string {
    const value = process.env[name]?.trim();
    return value === undefined || value === "" ? fallback : value;
}

function readPrivateKey(path: string): KeyObject {
    let pem: string;
    try {
        pem = readFileSync(path, "utf8");
    } catch {
        // Never echo the path's contents, and never let a filesystem error
        // carry key material into a log line.
        throw new AcrConfigError(`unable to read ACR_WEB_ASSERTION_KEY_FILE at ${path}`);
    }
    try {
        return createPrivateKey(pem);
    } catch {
        throw new AcrConfigError("ACR_WEB_ASSERTION_KEY_FILE is not a valid private key");
    }
}

/**
 * Repository scopes are a comma-separated allowlist of `owner/name` slugs. ACR
 * requires at least one (see `signWebAssertion`), and normalizes to lower case,
 * so the parse does the same rather than letting the service reject it.
 */
function parseRepositoryScopes(raw: string): readonly string[] {
    const scopes = raw
        .split(",")
        .map((scope) => scope.trim().toLowerCase())
        .filter((scope) => scope !== "");
    if (scopes.length === 0) {
        throw new AcrConfigError("ACR_REPOSITORY_SCOPES must list at least one repository slug");
    }
    return scopes;
}

export function loadAcrRuntimeConfig(): AcrRuntimeConfig {
    return {
        apiOrigin: required("ACR_API_ORIGIN").replace(/\/+$/u, ""),
        audience: optional("ACR_WEB_ASSERTION_AUDIENCE", "dev-health-acr"),
        issuer: optional("ACR_WEB_ASSERTION_ISSUER", "dev-health-web"),
        keyId: optional("ACR_WEB_ASSERTION_KID", "acr-dev-web"),
        orgId: required("ACR_ORG_ID"),
        privateKey: readPrivateKey(required("ACR_WEB_ASSERTION_KEY_FILE")),
        repositoryScopes: parseRepositoryScopes(required("ACR_REPOSITORY_SCOPES")),
        subject: optional("ACR_SUBJECT", "context-fabric-workbench"),
        timeoutMs: Number(optional("ACR_TIMEOUT_MS", "120000")),
    };
}
