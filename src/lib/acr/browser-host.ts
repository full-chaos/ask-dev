import {
    acrBrowserClientConfig,
    beginAcrRedirect,
    configureAcrAuth,
    setAcrLogger,
    type AcrBrowserClientConfig,
    type AcrSilentOutcome,
} from "@/acr-client";
import type { InvestigationResult } from "@/lib/contracts";

/**
 * The Workbench's host of the shared ACR browser client (CHAOS-12106). This app is a browser OAuth
 * client of ACR, as the web app is: the user is the signed-in web user, and consent happens on
 * web's review page. Nothing here is a secret.
 *
 * The Workbench has no session of its own, so its principal is one fixed value. ACR ties the token
 * family to the web session, and the redirect asks web who the user is.
 */

/** Where the tab returns to after the redirect. A same-origin path, never a URL. */
export const ACR_RETURN_KEY = "ask-dev:acr-return";

export const ACR_CALLBACK_PATH = "/oauth/callback";

/** A same-origin path (starts with `/`, never `//` or `/\`), or `undefined`. */
export function safeReturnPath(value: string | null | undefined): string | undefined {
    if (typeof value !== "string" || !value.startsWith("/")) return undefined;
    if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
    return value;
}

/** The client of this page. Off on the server, and with no issuer. */
export function acrClientConfig(): AcrBrowserClientConfig | undefined {
    if (typeof window === "undefined") return undefined;
    // Next inlines NEXT_PUBLIC_* by this exact name.
    return acrBrowserClientConfig(
        process.env.NEXT_PUBLIC_ACR_OAUTH_ISSUER,
        window.location.origin,
        {
            callback: ACR_CALLBACK_PATH,
        },
    );
}

setAcrLogger({
    // The lines are content-free: ids, statuses and closed reason codes.
    info: (fields, message) => console.info(message, fields),
    warn: (fields, message) => console.warn(message, fields),
    // CHAOS-12593: a schema refusal is an error, not a warning.
    error: (fields, message) => console.error(message, fields),
});

configureAcrAuth({
    config: acrClientConfig,
    session: () => Promise.resolve({ user: { id: "workbench" } }),
    routes: null,
});

function rememberReturnPath(): void {
    try {
        const path = safeReturnPath(window.location.pathname);
        if (path !== undefined) window.sessionStorage.setItem(ACR_RETURN_KEY, path);
    } catch {
        // No storage: the callback returns to `/`.
    }
}

/**
 * The client's `authorize` step. There is no silent step here, so it sends the tab to ACR and
 * ends the call: the transport answers `authorization_required` while the tab leaves.
 */
export async function authorizeByRedirect(): Promise<AcrSilentOutcome> {
    rememberReturnPath();
    const started = await beginAcrRedirect();
    if (started.kind === "impersonating") return { kind: "impersonating" };
    if (started.kind === "failed") return { kind: "failed", reason: started.reason };
    return { kind: "off" };
}

/** The result check the client asks for: the full event schema has already passed. */
export function isInvestigationResult(value: unknown): value is InvestigationResult {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { schema_version?: unknown }).schema_version === "string"
    );
}
