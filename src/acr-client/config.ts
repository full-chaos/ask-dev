/**
 * Which OAuth client of ACR a browser host is (CHAOS-12302; Ask Dev direct browser design §2.1). A
 * host is a first-party public client of acr-api: authorization code with PKCE S256, against an
 * issuer.
 *
 * - On an https origin the client is the client ID metadata document the host serves.
 * - On an http loopback origin (local, kiac) it is ACR's development-only static client
 *   `https://localhost/acr/dev-browser-client`, whose exact redirects ACR is configured with.
 * - Anything else, or no issuer, is no client: the browser client is off.
 *
 * This file is pure and safe on a server: a host's server code imports it through
 * `@full-chaos/ask-dev/acr-client/config`.
 */

/** The scopes the Ask Dev routes need: context:read; evidence:read for evidence. Never data:read. */
export const ACR_BROWSER_SCOPE = "context:read evidence:read";

/** ACR's development-only static browser client (acr `internal/auth/oauth.go`), never fetched. */
export const ACR_DEV_BROWSER_CLIENT_ID = "https://localhost/acr/dev-browser-client";

export type AcrBrowserClientConfig = {
    /** ACR's OAuth issuer, an exact origin: also the only resource the browser class may bind. */
    readonly issuer: string;
    /** The host's origin: the redirect URI's origin. */
    readonly webOrigin: string;
    /** The OAuth `client_id`. */
    readonly clientId: string;
    /** The exact `redirect_uri`. */
    readonly redirectUri: string;
    /** Whether the client is the host's metadata document (https) or ACR's development client. */
    readonly usesMetadataDocument: boolean;
};

/** Where a host keeps its client. */
export type AcrClientPaths = {
    /** The exact redirect URI path ACR holds for the client. */
    readonly callback: string;
    /** Where it serves its client ID metadata document; with none, https is no client. */
    readonly metadata?: string | undefined;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A plain host: DNS labels or an IPv6 literal. The URL parser keeps characters such as `*` in a
 * host, and a CSP source must never become a wildcard (CHAOS-12302).
 */
const PLAIN_HOST =
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])$/u;

function parse(raw: string): URL | undefined {
    try {
        const url = new URL(raw);
        return PLAIN_HOST.test(url.hostname) ? url : undefined;
    } catch {
        return undefined;
    }
}

/**
 * ACR's issuer rule: an https origin (http only on a loopback host), with no path, query,
 * fragment, user info or trailing slash. The value must be exactly that origin.
 */
function issuerOrigin(raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    const url = parse(value);
    if (url === undefined || url.username !== "" || url.password !== "") return undefined;
    const allowed =
        url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
    if (!allowed || url.origin !== value) return undefined;
    return url.origin;
}

/** The web origin of AUTH_URL (which may carry a path), https or http loopback. */
function webOriginOf(
    raw: string | undefined,
): { origin: string; loopbackHttp: boolean } | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    const url = parse(value);
    if (url === undefined || url.username !== "" || url.password !== "") return undefined;
    if (url.protocol === "https:") return { origin: url.origin, loopbackHttp: false };
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
        return { origin: url.origin, loopbackHttp: true };
    }
    return undefined;
}

/** The client for an issuer and a host origin, or `undefined` (off). */
export function acrBrowserClientConfig(
    issuerRaw: string | undefined,
    webOriginRaw: string | undefined,
    paths: AcrClientPaths,
): AcrBrowserClientConfig | undefined {
    const issuer = issuerOrigin(issuerRaw);
    const web = webOriginOf(webOriginRaw);
    if (issuer === undefined || web === undefined) return undefined;
    if (!web.loopbackHttp && paths.metadata === undefined) return undefined;
    return {
        issuer,
        webOrigin: web.origin,
        clientId: web.loopbackHttp
            ? ACR_DEV_BROWSER_CLIENT_ID
            : `${web.origin}${paths.metadata ?? ""}`,
        redirectUri: `${web.origin}${paths.callback}`,
        usesMetadataDocument: !web.loopbackHttp,
    };
}

/** The issuer origin the CSP may add to `connect-src`, or `undefined` (adds nothing). */
export function acrIssuerOriginForCsp(raw: string | undefined): string | undefined {
    return issuerOrigin(raw);
}
