import { createHash, randomBytes } from "node:crypto";

import capture from "./acr-oauth.capture.json";

/**
 * acr-api's browser OAuth endpoints, for the offline e2e of CHAOS-12303. The responses come from
 * the real producer, not hand-written JSON:
 * - The metadata, the authorize error redirect and the `invalid_grant` answers are acr-api's own
 *   responses, captured on askdev-1 (`acr-oauth.capture.json`, with the commands).
 * - The success token body follows acr's producer type at the web pin (the capture's
 *   `source.not_captured` names the file and lines).
 *
 * ACR's rules are kept:
 * - `iss` and `state` ride every authorize redirect, with the keys sorted like Go's url.Values.
 * - A code is spent before it is checked, so any reuse gets `invalid_grant`.
 * - The PKCE S256 verifier must match the challenge.
 * - The refresh grant rotates. The same consumed token within 30 s, while its successor is
 *   unused, gets the same successor. Any other reuse revokes the family (`invalid_grant`).
 * - A family lives 12 h. Revocation (RFC 7009) answers 200 for any token.
 */

const CAPTURED_ISSUER = capture.metadata.body.issuer;
/** acr `internal/auth/oauth.go`: the development-only static browser client. */
export const ACR_DEV_BROWSER_CLIENT_ID = "https://localhost/acr/dev-browser-client";
/** acr `internal/auth/browser_refresh.go:33`. */
export const ACR_REFRESH_GRACE_MS = 30_000;
/** acr `internal/auth/device_flow.go:25`. */
export const ACR_FAMILY_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** The browser class's access life: 10 minutes. */
export const ACR_ACCESS_LIFETIME_S = 600;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/u;

export type MockRequest = {
    readonly method: string;
    readonly url: string;
    readonly body?: string | null;
};

export type MockResponse = {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string;
};

export type MockCall =
    | { readonly kind: "metadata" }
    | { readonly kind: "authorize"; readonly params: Record<string, string> }
    | { readonly kind: "token"; readonly form: Record<string, string> }
    | { readonly kind: "revoke"; readonly form: Record<string, string> };

type Code = {
    readonly challenge: string;
    readonly redirectUri: string;
    readonly clientId: string;
    readonly resource: string;
    readonly scope: string;
    readonly expiresAt: number;
    spent: boolean;
};

type Family = { readonly expiresAt: number; revoked: boolean };

type Refresh = {
    readonly family: Family;
    consumedAt: number | null;
    successor: {
        readonly access: string;
        readonly refresh: string;
        readonly accessExpiresAt: number;
    } | null;
    readonly scope: string;
};

export type AcrOAuthMockOptions = {
    readonly issuer: string;
    readonly redirectUri: string;
    readonly clientId?: string;
    readonly now?: () => number;
    /** What the consent step does: web's no-click approval, or a denial. */
    readonly consent?: "approve" | "deny";
    /** A plant: the authorize redirect names another `iss`. */
    readonly redirectIss?: string;
};

function token(prefix: string): string {
    return prefix + randomBytes(32).toString("base64url");
}

function s256(verifier: string): string {
    return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Go's url.Values.Encode: keys sorted, application/x-www-form-urlencoded. */
function goQuery(values: Record<string, string>): string {
    return Object.keys(values)
        .sort()
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(values[key]!)}`)
        .join("&");
}

function form(body: string | null | undefined): Record<string, string> | null {
    const params = new URLSearchParams(body ?? "");
    const out: Record<string, string> = {};
    for (const key of new Set(params.keys())) {
        if (params.getAll(key).length > 1) return null;
        out[key] = params.get(key)!;
    }
    return out;
}

/** The headers acr-api sent with its JSON answers (captured). */
const JSON_HEADERS: Record<string, string> = Object.fromEntries(
    Object.entries(capture.token_invalid_grant.headers).filter(([key]) =>
        ["Content-Type", "Cache-Control", "Pragma", "X-Content-Type-Options"].includes(key),
    ),
);

export class AcrOAuthMock {
    readonly calls: MockCall[] = [];
    private readonly issuer: string;
    private readonly redirectUri: string;
    private readonly clientId: string;
    private readonly now: () => number;
    private readonly codes = new Map<string, Code>();
    private readonly refreshes = new Map<string, Refresh>();
    consent: "approve" | "deny";
    redirectIss: string | undefined;

    constructor(options: AcrOAuthMockOptions) {
        this.issuer = options.issuer;
        this.redirectUri = options.redirectUri;
        this.clientId = options.clientId ?? ACR_DEV_BROWSER_CLIENT_ID;
        this.now = options.now ?? Date.now;
        this.consent = options.consent ?? "approve";
        this.redirectIss = options.redirectIss;
    }

    /** The endpoints this mock answers: exactly ACR's four, on the issuer's origin. */
    owns(url: string): boolean {
        const parsed = new URL(url);
        if (parsed.origin !== this.issuer) return false;
        return [
            "/.well-known/oauth-authorization-server",
            "/authorize",
            "/token",
            "/revoke",
        ].includes(parsed.pathname);
    }

    handle(request: MockRequest): MockResponse {
        const url = new URL(request.url);
        switch (`${request.method} ${url.pathname}`) {
            case "GET /.well-known/oauth-authorization-server":
                this.calls.push({ kind: "metadata" });
                return this.metadata();
            case "GET /authorize":
                return this.authorize(url);
            case "POST /token":
                return this.token(request.body);
            case "POST /revoke":
                return this.revoke(request.body);
            default:
                return { status: 404, headers: JSON_HEADERS, body: "" };
        }
    }

    private json(status: number, body: unknown): MockResponse {
        return { status, headers: JSON_HEADERS, body: JSON.stringify(body) };
    }

    /** acr's error body (captured: `{"error":"invalid_grant"}` with these headers). */
    private error(code: string): MockResponse {
        return this.json(400, { error: code });
    }

    private metadata(): MockResponse {
        const body = JSON.parse(
            JSON.stringify(capture.metadata.body).replaceAll(CAPTURED_ISSUER, this.issuer),
        ) as unknown;
        return {
            status: capture.metadata.status,
            headers: capture.metadata.headers,
            body: JSON.stringify(body),
        };
    }

    private redirect(values: Record<string, string>): MockResponse {
        return {
            status: 303,
            headers: {
                "Cache-Control": "no-store",
                Location: `${this.redirectUri}?${goQuery(values)}`,
            },
            body: "",
        };
    }

    private authorize(url: URL): MockResponse {
        const params = Object.fromEntries(url.searchParams);
        this.calls.push({ kind: "authorize", params });
        // A wrong client or redirect never redirects (RFC 6749 §4.1.2.1).
        if (params.client_id !== this.clientId || params.redirect_uri !== this.redirectUri) {
            return {
                status: 400,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: "invalid_request",
            };
        }
        const iss = this.redirectIss ?? this.issuer;
        const answer = (values: Record<string, string>) =>
            this.redirect(
                params.state === undefined
                    ? { ...values, iss }
                    : { ...values, iss, state: params.state },
            );
        const scopes = (params.scope ?? "").split(" ").filter(Boolean);
        const supported = capture.metadata.body.scopes_supported;
        if (
            params.response_type !== "code" ||
            !B64URL_43.test(params.code_challenge ?? "") ||
            params.code_challenge_method !== "S256" ||
            (params.resource !== undefined && params.resource !== this.issuer) ||
            (params.state !== undefined && params.state.length > 1024) ||
            !scopes.every((scope) => supported.includes(scope))
        ) {
            return answer({ error: "invalid_request" });
        }
        if (this.consent === "deny") return answer({ error: "access_denied" });
        const code = randomBytes(32).toString("base64url");
        this.codes.set(code, {
            challenge: params.code_challenge!,
            redirectUri: params.redirect_uri,
            clientId: params.client_id,
            resource: params.resource ?? this.issuer,
            scope: scopes.length === 0 ? "context:read evidence:read" : scopes.join(" "),
            expiresAt: this.now() + CODE_LIFETIME_MS,
            spent: false,
        });
        return answer({ code });
    }

    private issue(scope: string): MockResponse {
        const access = token("fcacr_");
        const refresh = token("acrrt_");
        const family: Family = { expiresAt: this.now() + ACR_FAMILY_LIFETIME_MS, revoked: false };
        this.refreshes.set(refresh, { family, consumedAt: null, successor: null, scope });
        return this.json(200, {
            access_token: access,
            token_type: "Bearer",
            expires_in: ACR_ACCESS_LIFETIME_S,
            scope,
            refresh_token: refresh,
        });
    }

    private token(body: string | null | undefined): MockResponse {
        const values = form(body);
        this.calls.push({ kind: "token", form: values ?? {} });
        if (values === null || values.client_id === undefined) return this.error("invalid_request");
        if (values.grant_type === "authorization_code") {
            const code = this.codes.get(values.code ?? "");
            if (code === undefined || code.spent) return this.error("invalid_grant");
            // Spent first: a reuse is invalid_grant whatever else it carries.
            code.spent = true;
            if (
                this.now() >= code.expiresAt ||
                values.client_id !== code.clientId ||
                values.redirect_uri !== code.redirectUri ||
                (values.resource ?? code.resource) !== code.resource ||
                s256(values.code_verifier ?? "") !== code.challenge
            ) {
                return this.error("invalid_grant");
            }
            return this.issue(code.scope);
        }
        if (values.grant_type === "refresh_token") return this.refresh(values);
        return this.error("unsupported_grant_type");
    }

    private refresh(values: Record<string, string>): MockResponse {
        if (values.client_id !== this.clientId) return this.error("unauthorized_client");
        const presented = this.refreshes.get(values.refresh_token ?? "");
        if (presented === undefined) return this.error("invalid_grant");
        const { family } = presented;
        if (family.revoked || this.now() >= family.expiresAt) return this.error("invalid_grant");
        if (presented.consumedAt === null) {
            const access = token("fcacr_");
            const refresh = token("acrrt_");
            presented.consumedAt = this.now();
            presented.successor = {
                access,
                refresh,
                accessExpiresAt: this.now() + ACR_ACCESS_LIFETIME_S * 1000,
            };
            this.refreshes.set(refresh, {
                family,
                consumedAt: null,
                successor: null,
                scope: presented.scope,
            });
            return this.json(200, {
                access_token: access,
                token_type: "Bearer",
                expires_in: ACR_ACCESS_LIFETIME_S,
                scope: presented.scope,
                refresh_token: refresh,
            });
        }
        const successor = presented.successor!;
        const successorUnused = this.refreshes.get(successor.refresh)?.consumedAt === null;
        if (this.now() - presented.consumedAt <= ACR_REFRESH_GRACE_MS && successorUnused) {
            return this.json(200, {
                access_token: successor.access,
                token_type: "Bearer",
                expires_in: Math.max(
                    1,
                    Math.round((successor.accessExpiresAt - this.now()) / 1000),
                ),
                scope: presented.scope,
                refresh_token: successor.refresh,
            });
        }
        family.revoked = true;
        return this.error("invalid_grant");
    }

    private revoke(body: string | null | undefined): MockResponse {
        const values = form(body) ?? {};
        this.calls.push({ kind: "revoke", form: values });
        const presented = this.refreshes.get(values.token ?? "");
        if (presented !== undefined) presented.family.revoked = true;
        return this.json(200, {});
    }
}
