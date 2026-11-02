/**
 * The browser's ACR OAuth flow and token store (CHAOS-12303, c2 of the T13 split; Ask Dev direct
 * browser design §2.1, §2.2, §7). A host is a first-party public client of acr-api: authorization
 * code with PKCE S256. The client, issuer and redirect come from the host, through
 * `configureAcrAuth`, with its session read and its same-origin routes.
 * Below, "web" is the host that holds the user's session.
 *
 * Storage rules (design §2.2, §7):
 * - The access token (`fcacr_`) is held in this module's memory only.
 * - The refresh token (`acrrt_`), the client id and the revocation endpoint are in
 *   `sessionStorage`, under `ask-dev:acr-family`.
 * - None of them goes to React state, a URL, `localStorage`, a log, telemetry or Sentry.
 *
 * The flow (CHAOS-12474, amending design §2.1): a user signed in to web never sees a connect step.
 * The browser stays the OAuth public client: it holds the PKCE verifier and runs the `/token`
 * exchange. Web's server only runs `/authorize` from the signed-in session, so this is no data
 * proxy, and the ruling against a server hop in front of ACR (CHAOS-3743) still holds.
 * 1. `authorizeAcrSilently` reads the web principal. If it cannot, it makes no attempt: a code is
 *    bound to the session that asked (codex r1 on #1714). Then it makes the verifier and the state,
 *    in this call's memory only, reads ACR's metadata for the token and revocation endpoints, and
 *    POSTs `{code_challenge, state}` to `/api/ask-dev/authorize`, which takes everything else from
 *    its own config.
 * 2. Web's server calls ACR's `GET /authorize` with no cookie and follows no redirect. It takes the
 *    handle from the consent URL in ACR's 302, and T4c's `openOAuthConsent` approves it with no
 *    click. It answers `{code, state, iss}` as JSON, `no-store`. It never answers ACR's URL.
 * 3. This module checks `state`, the tab, the expiry and `iss`, and exchanges the code at `/token`
 *    with a form POST, which is not preflighted. Nothing touches `window.location`.
 *
 * When the silent step runs (the lead's condition 3 on CHAOS-12474): only at a user act, or after a
 * 401. The transport decides, and `getAcrAccessToken()` never starts it, so a panel open and a
 * background read send nothing (P1-6). The acts are a question, a History read, opening a
 * conversation or evidence, and each Try again. One attempt per tab runs at a time: every caller
 * that comes while it runs shares it.
 *
 * Refresh across tabs, the principal binding, clone detection and the sign-out hook are c4
 * (CHAOS-12305):
 * - The family and the access token are bound to the web principal (user id and org id) at the
 *   exchange. Every reader drops both when the principal changes or there is no session.
 * - `getAcrAccessToken()` serves the held token until 80 % of its life, then refreshes it with the
 *   family, serialized per family across the origin's tabs by a Web Lock.
 * - ACR rotates the refresh token. A lost refresh response is retried once, with the same token,
 *   only inside ACR's 30 s grace; anything else that fails clears the family (fails closed).
 * - A duplicated tab gets a copy of this tab's `sessionStorage`. On its first use of the store, a
 *   tab asks the origin's tabs (BroadcastChannel `ask-dev:acr-tabs`) whether another tab holds
 *   its tab id. If one does, this tab is the copy: it takes a new tab id and drops the copied
 *   family. Known limit: when the original tab is on a page without this module, nobody answers;
 *   both tabs then share the family, ACR's reuse rule revokes it, and both re-authorize. That
 *   fails closed (T16's live proof).
 * - Nothing here sends a request at module load. A request happens only inside
 *   `getAcrAccessToken()` and `authorizeAcrSilently()`.
 *
 * Impersonation (CHAOS-12306, c5): while an admin impersonates, `user.id` stays the admin's and
 * `org_id` is the target's org, so the binding above does not change when the target is in the
 * same org. The principal read therefore says "impersonating", and no token is held, served or
 * started for that session. The conversation context also clears every tab's tokens when the
 * impersonation starts or ends; this module's check is the defence in depth (a direct call, other
 * tabs). Web's route refuses the same session on its own side: no code leaves it.
 *
 * Logs (CHAOS-12369): the failure and refusal paths log at Info or Warn, one line per event, all
 * starting with "ask-dev acr token store". A line carries the family id (random, not a secret), an
 * enum reason, a boolean or an HTTP status. It never carries a token, a code, a verifier, a state,
 * a tab id, a user or org id, or a URL. A served held token logs nothing.
 */
import { ACR_BROWSER_SCOPE, type AcrBrowserClientConfig } from "./config";
import { logger } from "./logger";

/** The token family this tab holds: the refresh token and where it is used. */
export const ACR_TOKEN_FAMILY_KEY = "ask-dev:acr-family";
/** This tab's authorization while the tab is away at ACR: written by begin, taken by complete. */
export const ACR_PENDING_AUTHORIZATION_KEY = "ask-dev:acr-authorization";
/** This tab's id. c4 replaces it when it finds a cloned tab. */
export const ACR_TAB_KEY = "ask-dev:acr-tab";

/** How long a started authorization may take to come back. */
export const ACR_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
/**
 * How long one ACR request may take, its body included (r3 on web #1663). Design §5's status reads
 * are bounded at 15 s too. A request that hits it counts as "ACR unavailable". Not named
 * `ACR_REQUEST_TIMEOUT_MS`: that is a server environment variable, and the secret boundary spec
 * fails a client chunk that holds its name (CHAOS-12104, where this module joined every page).
 */
export const ACR_OAUTH_REQUEST_TIMEOUT_MS = 15_000;
/** An access token this close to its expiry counts as expired. */
export const ACR_ACCESS_TOKEN_SKEW_MS = 30 * 1000;
/** The held access token is refreshed once this share of its life is gone (CHAOS-12305). */
export const ACR_ACCESS_TOKEN_REFRESH_AT = 0.8;
/**
 * A lost refresh response is retried once, with the same refresh token, only while the first
 * attempt started less than this long ago. ACR gives the same successor to the same consumed
 * token for 30 s (while the successor is unused); any later reuse revokes the family
 * (CHAOS-12305).
 */
export const ACR_REFRESH_RETRY_WINDOW_MS = 25_000;
/** Each family's refresh lock, across the origin's tabs, is this prefix plus its family id. */
export const ACR_REFRESH_LOCK_PREFIX = "ask-dev:acr-refresh:";
/** The origin's tabs talk here: clone detection (`hello`/`taken`) and sign-out (`clear`). */
export const ACR_TABS_CHANNEL = "ask-dev:acr-tabs";
/** How long a tab's clone check waits for a `taken` answer (CHAOS-12305). */
export const ACR_CLONE_CHECK_MS = 200;

const ACCESS_TOKEN = /^fcacr_[A-Za-z0-9_-]{43}$/u;
const REFRESH_TOKEN = /^acrrt_[A-Za-z0-9_-]{43}$/u;
/** A PKCE verifier or state: 32 random bytes, base64url, no padding. */
const RANDOM_43 = /^[A-Za-z0-9_-]{43}$/u;
const TAB_ID = /^[A-Za-z0-9_-]{22}$/u;
/** A family id: 16 random bytes, base64url, like a tab id. */
const FAMILY_ID = TAB_ID;

export type AcrAuthorizationServer = {
    readonly issuer: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    /** Advertised only when ACR serves the browser refresh grant. */
    readonly revocationEndpoint: string | null;
};

/**
 * One silent authorization, in the memory of its own call: the verifier reaches no storage, no
 * route and no log. It leaves the browser only to ACR's `/token`.
 */
type AuthorizationRequest = {
    readonly state: string;
    readonly verifier: string;
    readonly tabId: string;
    readonly issuer: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly tokenEndpoint: string;
    readonly revocationEndpoint: string | null;
    readonly expiresAt: number;
    /** Who asked: the code is for this session. Never unknown: then no attempt starts. */
    readonly askedBy: AcrPrincipal;
    /** The drop counter when this started: a clear after it wins, wherever it lands. */
    readonly dropsAtStart: number;
};

/** The web session the family and the access token are bound to (CHAOS-12305). */
export type AcrPrincipal = { readonly userId: string; readonly orgId: string | null };

/** An impersonating web session: it gets no ACR token (CHAOS-12306). */
export type AcrImpersonating = { readonly impersonating: true };

/** What the principal seam reads: the principal, an impersonating session, or null (no session). */
export type AcrPrincipalRead = AcrPrincipal | AcrImpersonating | null;

/**
 * What the family entry in `sessionStorage` holds. The sign-out hook reads it. v2 (CHAOS-12305)
 * adds the family id and the principal; a v1 entry names no principal and is ignored.
 */
export type AcrHeldFamily = {
    readonly v: 2;
    /** Random, made at the exchange; names the family's refresh lock. A cloned tab copies it. */
    readonly familyId: string;
    readonly issuer: string;
    readonly clientId: string;
    readonly refreshToken: string;
    readonly tokenEndpoint: string;
    readonly revocationEndpoint: string | null;
    readonly userId: string;
    readonly orgId: string | null;
};

/** The messages on `ACR_TABS_CHANNEL`. They carry no token. */
export type AcrTabMessage =
    | { readonly type: "hello"; readonly tabId: string }
    | { readonly type: "taken"; readonly tabId: string }
    | { readonly type: "clear" };

/** The origin's tab channel: a BroadcastChannel in the browser. */
export type AcrTabChannel = {
    /** Reaches every other tab of the origin, never this one. */
    readonly post: (message: AcrTabMessage) => void;
    /** What other tabs post; untrusted shape until checked. */
    readonly onMessage: (handler: (message: unknown) => void) => void;
};

export type AcrAccessToken =
    | { readonly kind: "token"; readonly token: string; readonly issuer: string }
    | { readonly kind: "authorization_required" }
    | { readonly kind: "off" };

/** Why a silent authorization did not end in a token. Content-free: safe to log. */
export type AcrAuthorizationFailure =
    /** ACR's metadata, the route or the network did not answer. */
    | "unavailable"
    /** Web's route refused for a reason the browser cannot act on; its own log names it. */
    | "refused"
    /** The session read gave nothing at the start, and no answer says it ended: no attempt. */
    | "principal_unknown"
    /** The route answered 200 with no `{code, state, iss}`. */
    | "invalid_answer"
    | "expired"
    | "state_mismatch"
    | "wrong_tab"
    | "iss_mismatch"
    | "token_refused"
    | "token_unavailable"
    | "invalid_token_response"
    /** The route gave a code, and then the session could not be read or changed: nothing is held. */
    | "signed_out";

/** What one silent authorization ended in. */
export type AcrSilentOutcome =
    | { readonly kind: "token"; readonly token: string; readonly issuer: string }
    /** No configured client: nothing was sent. */
    | { readonly kind: "off" }
    /** The server says the session has ended: the way on is the normal sign-in. */
    | { readonly kind: "session_ended" }
    /** No ACR token for an impersonating session (CHAOS-12306): no code, no token. */
    | { readonly kind: "impersonating" }
    /** The organization has no Agent Context Runtime: asking again cannot help. */
    | { readonly kind: "not_entitled" }
    /** ACR's limit, or web's budget per user (429). The next act may try again; nothing here does. */
    | { readonly kind: "rate_limited" }
    | { readonly kind: "failed"; readonly reason: AcrAuthorizationFailure };

type Held = AcrPrincipal & {
    readonly token: string;
    readonly issuer: string;
    readonly clientId: string;
    readonly expiresAt: number;
    /** When this tab received it, and its life: the refresh starts at 80 % of it. */
    readonly issuedAt: number;
    readonly lifetimeMs: number;
};

/** The access token: this module's memory only. */
let held: Held | null = null;
/** The channel this tab's listener is on; null until the store's first use. */
let listeningOn: AcrTabChannel | null = null;
/** This page load's clone check, once started: it runs once. */
let cloneCheck: Promise<void> | null = null;
/** The `hello` this tab waits on an answer to. */
let awaitingTaken: { readonly tabId: string; readonly taken: () => void } | null = null;
/** Counts drops. A refresh that a drop overtook must not store its answer (sign-out, clone). */
let drops = 0;
/** This tab's silent authorization while it runs: every caller shares it (CHAOS-12474). */
let authorizing: Promise<AcrSilentOutcome> | null = null;

/** What the token store reads of the host's session. */
export type AcrHostSession = {
    readonly user?:
        | {
              readonly id?: unknown;
              readonly org_id?: unknown;
              readonly is_impersonating?: unknown;
          }
        | null
        | undefined;
} | null;

export type AcrHostRoutes = {
    /** Runs `/authorize` from the signed-in session (CHAOS-12474). */
    readonly authorize: string;
    /** Answers the session as JSON: the authority on whether it has ended. */
    readonly session: string;
};

/** What a host gives the token store. */
export type AcrAuthHost = Pick<Dependencies, "config" | "session" | "routes">;

type Dependencies = {
    readonly fetch: typeof fetch;
    readonly now: () => number;
    readonly storage: () => Storage | null;
    /** Runs `task` while no other tab of the origin holds the same lock. */
    readonly lock: <T>(name: string, task: () => Promise<T>) => Promise<T>;
    readonly config: () => AcrBrowserClientConfig | undefined;
    /** The host's session read. It may reject; that reads as no session. */
    readonly session: () => Promise<AcrHostSession>;
    /** The host's same-origin routes; null for a host with no silent step (`beginAcrRedirect`). */
    readonly routes: AcrHostRoutes | null;
    /** Sends this tab to ACR. */
    readonly navigate: (url: string) => void;
    /**
     * The session's principal; null with no session or on error (CHAOS-12305); an impersonating
     * session reads as such (CHAOS-12306).
     */
    readonly principal: () => Promise<AcrPrincipalRead>;
    /** The origin's tab channel; null without BroadcastChannel, which skips the clone check. */
    readonly channel: () => AcrTabChannel | null;
};

let browserTabs: AcrTabChannel | null = null;

/** One BroadcastChannel per page, made on first use. */
function browserTabChannel(): AcrTabChannel | null {
    if (browserTabs !== null) return browserTabs;
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
    try {
        const channel = new BroadcastChannel(ACR_TABS_CHANNEL);
        browserTabs = {
            post: (message) => {
                try {
                    channel.postMessage(message);
                } catch {
                    // A closed channel: there is no other tab to tell.
                }
            },
            onMessage: (handler) =>
                channel.addEventListener("message", (event) => handler(event.data)),
        };
    } catch {
        return null;
    }
    return browserTabs;
}

const browserDependencies: Dependencies = {
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    storage: () => {
        try {
            return typeof window === "undefined" ? null : window.sessionStorage;
        } catch {
            return null;
        }
    },
    lock: (name, task) =>
        typeof navigator !== "undefined" && navigator.locks !== undefined
            ? navigator.locks.request(name, task)
            : inTabLock(name, task),
    config: () => undefined,
    session: () => Promise.resolve(null),
    routes: null,
    navigate: (url) => window.location.assign(url),
    principal: async () => {
        try {
            const session = await dependencies.session();
            const userId = session?.user?.id;
            if (typeof userId !== "string" || userId === "") return null;
            // The admin's user id stays while impersonating: only this flag shows it (CHAOS-12306).
            if (session?.user?.is_impersonating) return { impersonating: true };
            const orgId = session?.user?.org_id;
            if (orgId === undefined || orgId === null || orgId === "") {
                return { userId, orgId: null };
            }
            // Any other shape is no known principal: two of them must never compare as equal.
            return typeof orgId === "string" ? { userId, orgId } : null;
        } catch {
            return null;
        }
    },
    channel: browserTabChannel,
};

let configured: Dependencies = browserDependencies;
let dependencies: Dependencies = configured;

/** Sets what the host gives the store. A host calls it once, before the store's first use. */
export function configureAcrAuth(host: AcrAuthHost): void {
    configured = { ...browserDependencies, ...host };
    dependencies = configured;
}

/** The lock chains of this document, for a browser with no Web Locks. */
const inTabLocks = new Map<string, Promise<void>>();

/**
 * With no Web Locks, the lock still serializes this document's tasks of one name (codex r1 on
 * #1676: two calls in one tab must not present one refresh token twice). Across tabs there is then
 * no lock: a family shared that way meets ACR's reuse rule and fails closed.
 */
function inTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
    const run = (inTabLocks.get(name) ?? Promise.resolve()).then(task);
    const tail = run.then(
        () => undefined,
        () => undefined,
    );
    inTabLocks.set(name, tail);
    void tail.then(() => {
        if (inTabLocks.get(name) === tail) inTabLocks.delete(name);
    });
    return run;
}

/**
 * Tests only: replace the browser seams, and start a new page load's clone check. With no
 * argument, restore them and drop the token.
 */
export function setAcrAuthDependenciesForTest(next?: Partial<Dependencies>): void {
    dependencies = next === undefined ? configured : { ...configured, ...next };
    cloneCheck = null;
    awaitingTaken = null;
    authorizing = null;
    if (next === undefined) {
        held = null;
        listeningOn = null;
    }
}

/** A signal that aborts at ACR_OAUTH_REQUEST_TIMEOUT_MS, or when `outer` aborts; `clear` ends it. */
function deadline(outer?: AbortSignal): {
    readonly signal: AbortSignal;
    readonly clear: () => void;
} {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new DOMException("ACR did not answer in time", "TimeoutError")),
        ACR_OAUTH_REQUEST_TIMEOUT_MS,
    );
    const follow = () => controller.abort(outer?.reason);
    if (outer?.aborted) follow();
    else outer?.addEventListener("abort", follow, { once: true });
    return {
        signal: controller.signal,
        clear: () => {
            clearTimeout(timer);
            outer?.removeEventListener("abort", follow);
        },
    };
}

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function randomBase64Url(length: number): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
}

/** RFC 7636 S256: BASE64URL(SHA-256(ASCII(verifier))), 43 characters. */
export async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
}

function readJson(storage: Storage, key: string): unknown {
    try {
        const raw = storage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePrincipal(a: AcrPrincipal, b: AcrPrincipal): boolean {
    return a.userId === b.userId && a.orgId === b.orgId;
}

function isImpersonating(read: AcrPrincipalRead): read is AcrImpersonating {
    return read !== null && "impersonating" in read;
}

/** Where the principal was checked when a drop followed (CHAOS-12369). */
type PrincipalCheck =
    "begin" | "before" | "lock" | "after_refresh" | "exchange_before" | "exchange_after";

/** One Warn line for a drop or refusal for a principal reason (CHAOS-12369). No id values. */
function logPrincipal(
    check: PrincipalCheck,
    reason: "no_session" | "mismatch" | "impersonating",
): void {
    logger.warn({ check, reason }, "ask-dev acr token store principal dropped");
}

/** Why a principal read ended in a drop, for the log (CHAOS-12369). */
function principalReason(read: AcrPrincipalRead): "no_session" | "mismatch" | "impersonating" {
    if (read === null) return "no_session";
    return isImpersonating(read) ? "impersonating" : "mismatch";
}

/** A clear overtook an operation that was about to store or serve something (CHAOS-12369). */
function logClearRace(where: "refresh" | "after_refresh_check" | "exchange"): void {
    logger.warn({ where }, "ask-dev acr token store clear overtook");
}

/** Drops this tab's access token and family (CHAOS-12305). */
function dropTokens(storage: Storage | null): void {
    held = null;
    drops += 1;
    storage?.removeItem(ACR_TOKEN_FAMILY_KEY);
    storage?.removeItem(ACR_PENDING_AUTHORIZATION_KEY);
}

function onTabMessage(channel: AcrTabChannel, message: unknown): void {
    if (!isRecord(message)) return;
    if (message.type === "clear") {
        logger.info({ source: "other_tab" }, "ask-dev acr token store clear received");
        dropTokens(dependencies.storage());
        return;
    }
    if (typeof message.tabId !== "string" || !TAB_ID.test(message.tabId)) return;
    if (message.type === "hello") {
        // Another tab holds this tab's id: it is a copy of this tab. Tell it the id is taken.
        if (message.tabId === dependencies.storage()?.getItem(ACR_TAB_KEY)) {
            channel.post({ type: "taken", tabId: message.tabId });
        }
        return;
    }
    if (message.type === "taken" && awaitingTaken?.tabId === message.tabId) awaitingTaken.taken();
}

/**
 * Installs this tab's listener on the tab channel, once. Lazily: on the first use of the store,
 * and when the sign-out hook loads (every page), so a tab clears on `clear` and answers a clone.
 */
export function listenForAcrTabs(): void {
    const channel = dependencies.channel();
    if (channel === null || channel === listeningOn) return;
    listeningOn = channel;
    channel.onMessage((message) => onTabMessage(channel, message));
}

/**
 * Whether another tab holds this tab's id: a duplicated tab or `window.open` copies
 * `sessionStorage`. The copy takes a new id and drops the copied family and token. Once per page
 * load. Skipped without a channel, or without a tab id (then nothing was copied).
 */
function checkClone(storage: Storage): Promise<void> {
    cloneCheck ??= (async () => {
        const channel = dependencies.channel();
        const id = storage.getItem(ACR_TAB_KEY);
        if (channel === null || id === null || !TAB_ID.test(id)) return;
        const taken = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                awaitingTaken = null;
                resolve(false);
            }, ACR_CLONE_CHECK_MS);
            awaitingTaken = {
                tabId: id,
                taken: () => {
                    clearTimeout(timer);
                    awaitingTaken = null;
                    resolve(true);
                },
            };
            channel.post({ type: "hello", tabId: id });
        });
        if (!taken) return;
        const droppedFamily = storage.getItem(ACR_TOKEN_FAMILY_KEY) !== null;
        storage.setItem(ACR_TAB_KEY, randomBase64Url(16));
        dropTokens(storage);
        logger.info({ dropped_family: droppedFamily }, "ask-dev acr token store clone dropped");
    })();
    return cloneCheck;
}

/** This tab's id, made on first use. */
function tabId(storage: Storage): string {
    const existing = storage.getItem(ACR_TAB_KEY);
    if (existing !== null && TAB_ID.test(existing)) return existing;
    const created = randomBase64Url(16);
    storage.setItem(ACR_TAB_KEY, created);
    return created;
}

/** An endpoint ACR advertises: an absolute URL on the issuer's own origin, no user info. */
function endpointOn(issuer: string, raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    try {
        const url = new URL(raw);
        if (
            url.origin !== issuer ||
            url.username !== "" ||
            url.password !== "" ||
            url.hash !== ""
        ) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

/**
 * ACR's authorization server metadata (RFC 8414), read live each time an authorization runs, and
 * so never on a panel open. The silent step needs it for the `/token` endpoint and for the
 * revocation endpoint the family keeps for sign-out. The document must name this issuer, S256 and
 * the `iss` response parameter, and its endpoints must be on the issuer's origin.
 */
export async function discoverAcrAuthorizationServer(
    issuer: string,
    signal?: AbortSignal,
): Promise<AcrAuthorizationServer | null> {
    let body: unknown;
    const limit = deadline(signal);
    try {
        const response = await dependencies.fetch(
            `${issuer}/.well-known/oauth-authorization-server`,
            {
                method: "GET",
                headers: { Accept: "application/json" },
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                signal: limit.signal,
            },
        );
        if (!response.ok) return null;
        body = await response.json();
    } catch {
        return null;
    } finally {
        limit.clear();
    }
    if (!isRecord(body) || body.issuer !== issuer) return null;
    const methods = body.code_challenge_methods_supported;
    if (!Array.isArray(methods) || !methods.includes("S256")) return null;
    if (body.authorization_response_iss_parameter_supported !== true) return null;
    const authorizationEndpoint = endpointOn(issuer, body.authorization_endpoint);
    const tokenEndpoint = endpointOn(issuer, body.token_endpoint);
    if (authorizationEndpoint === null || tokenEndpoint === null) return null;
    const revocationEndpoint =
        body.revocation_endpoint === undefined
            ? null
            : endpointOn(issuer, body.revocation_endpoint);
    if (body.revocation_endpoint !== undefined && revocationEndpoint === null) return null;
    return { issuer, authorizationEndpoint, tokenEndpoint, revocationEndpoint };
}

type TokenAnswer =
    | {
          readonly kind: "ok";
          readonly access: string;
          readonly expiresIn: number;
          readonly refresh: string | null;
          readonly status: number;
      }
    | { readonly kind: "refused"; readonly status: number }
    | { readonly kind: "unavailable"; readonly status?: number }
    | { readonly kind: "invalid"; readonly status?: number };

async function exchangeCode(request: AuthorizationRequest, code: string): Promise<TokenAnswer> {
    return postTokenForm(
        request.tokenEndpoint,
        new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: request.redirectUri,
            client_id: request.clientId,
            code_verifier: request.verifier,
            resource: request.issuer,
        }),
    );
}

/** ACR's refresh grant (CHAOS-12305). It rotates: the caller requires the new refresh token. */
function refreshGrant(family: AcrHeldFamily): Promise<TokenAnswer> {
    return postTokenForm(
        family.tokenEndpoint,
        new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: family.refreshToken,
            client_id: family.clientId,
        }),
    );
}

/** One POST to ACR's token endpoint, under the request deadline, with the answer's shape checked. */
async function postTokenForm(endpoint: string, form: URLSearchParams): Promise<TokenAnswer> {
    let response: Response;
    let body: unknown;
    const limit = deadline();
    try {
        try {
            // A form POST with only safelisted headers: no CORS preflight (design §7).
            response = await dependencies.fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: form,
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                signal: limit.signal,
            });
        } catch {
            return { kind: "unavailable" };
        }
        const { status } = response;
        if (status === 400 || status === 401) return { kind: "refused", status };
        if (!response.ok) return { kind: "unavailable", status };
        try {
            body = await response.json();
        } catch {
            return limit.signal.aborted
                ? { kind: "unavailable", status }
                : { kind: "invalid", status };
        }
    } finally {
        limit.clear();
    }
    const status = response.status;
    if (!isRecord(body)) return { kind: "invalid", status };
    const {
        access_token: access,
        token_type: type,
        expires_in: expiresIn,
        refresh_token: refresh,
    } = body;
    if (typeof access !== "string" || !ACCESS_TOKEN.test(access))
        return { kind: "invalid", status };
    if (typeof type !== "string" || type.toLowerCase() !== "bearer") {
        return { kind: "invalid", status };
    }
    if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) {
        return { kind: "invalid", status };
    }
    if (refresh !== undefined && (typeof refresh !== "string" || !REFRESH_TOKEN.test(refresh))) {
        return { kind: "invalid", status };
    }
    return { kind: "ok", access, expiresIn, refresh: refresh ?? null, status };
}

/** What web's route answered with a code: never a URL (CHAOS-12474). */
type AuthorizationCode = { readonly code: string; readonly state: string; readonly iss: string };

function failed(reason: AcrAuthorizationFailure): AcrSilentOutcome {
    return { kind: "failed", reason };
}

/**
 * Finishes one authorization with what the route answered. It checks `state`, the tab, the expiry
 * and `iss`, then the web principal, then exchanges the code once. Every failure is content-free.
 */
async function completeAuthorization(
    storage: Storage,
    request: AuthorizationRequest,
    answer: AuthorizationCode,
): Promise<AcrSilentOutcome> {
    const config = dependencies.config();
    if (config === undefined) return { kind: "off" };
    if (dependencies.now() >= request.expiresAt) return failed("expired");
    if (!RANDOM_43.test(request.state) || answer.state !== request.state) {
        return failed("state_mismatch");
    }
    if (request.tabId !== storage.getItem(ACR_TAB_KEY)) return failed("wrong_tab");
    // The issuer this tab started with is the one configured now and the one that answered.
    if (request.issuer !== config.issuer || answer.iss !== request.issuer) {
        return failed("iss_mismatch");
    }
    if (request.clientId !== config.clientId || request.redirectUri !== config.redirectUri) {
        return failed("iss_mismatch");
    }
    // The family is bound to the web principal (CHAOS-12305). With no session, no code is sent and
    // nothing is stored. It stays a failure, not "session ended": the route, which is the authority
    // on the session, gave this code a moment ago, so this read may only have failed.
    const principal = await dependencies.principal();
    if (principal === null) {
        logPrincipal("exchange_before", "no_session");
        return failed("signed_out");
    }
    // Impersonating (CHAOS-12306): as signed out, nothing is sent or stored.
    if (isImpersonating(principal)) {
        dropTokens(storage);
        logPrincipal("exchange_before", "impersonating");
        return { kind: "impersonating" };
    }
    // The route ran for the session of the ask: a code is never bound to a later one.
    if (!samePrincipal(request.askedBy, principal)) {
        logPrincipal("exchange_before", "mismatch");
        return failed("signed_out");
    }
    if (drops !== request.dropsAtStart) {
        logClearRace("exchange");
        return failed("signed_out");
    }
    const exchange = await exchangeCode(request, answer.code);
    if (exchange.kind === "refused") return failed("token_refused");
    if (exchange.kind === "unavailable") return failed("token_unavailable");
    if (exchange.kind === "invalid") return failed("invalid_token_response");
    // A sign-out, or another web user, while the exchange ran: hold and store nothing, so nothing
    // outlives the sign-out that could not revoke it (codex r2 on #1676).
    const after = await dependencies.principal();
    // An impersonation that started while the exchange ran: hold and store nothing (CHAOS-12306).
    if (isImpersonating(after)) {
        dropTokens(storage);
        logPrincipal("exchange_after", "impersonating");
        return { kind: "impersonating" };
    }
    if (drops !== request.dropsAtStart) {
        // Anywhere in the attempt: the counter is read before its first await (codex r2 on #1681).
        logClearRace("exchange");
        return failed("signed_out");
    }
    if (after === null || !samePrincipal(after, principal)) {
        logPrincipal("exchange_after", principalReason(after));
        return failed("signed_out");
    }
    hold(exchange.access, exchange.expiresIn, request.issuer, request.clientId, principal);
    if (exchange.refresh === null) {
        storage.removeItem(ACR_TOKEN_FAMILY_KEY);
    } else {
        const family: AcrHeldFamily = {
            v: 2,
            familyId: randomBase64Url(16),
            issuer: request.issuer,
            clientId: request.clientId,
            refreshToken: exchange.refresh,
            tokenEndpoint: request.tokenEndpoint,
            revocationEndpoint: request.revocationEndpoint,
            userId: principal.userId,
            orgId: principal.orgId,
        };
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(family));
    }
    return { kind: "token", token: exchange.access, issuer: request.issuer };
}

/** What the route's refusal means here. A body that names nothing is only its status. */
function routeRefusal(status: number, body: unknown): AcrSilentOutcome {
    const error = isRecord(body) ? body.error : undefined;
    const code = isRecord(error) ? error.code : undefined;
    if (status === 401) return { kind: "session_ended" };
    if (status === 429) return { kind: "rate_limited" };
    if (code === "impersonating") return { kind: "impersonating" };
    if (code === "not_entitled") return { kind: "not_entitled" };
    if (code === "client_off") return { kind: "off" };
    return failed(
        typeof code === "string" && code !== "acr_unavailable" ? "refused" : "unavailable",
    );
}

/**
 * One same-origin POST to web's route. Only the challenge and the state go: the verifier does not,
 * and the route takes the rest from its own config. `redirect: "manual"`: the proxy answers a
 * session that ended with a redirect to sign-in, which is not this call's page to follow.
 */
async function askForCode(
    routes: AcrHostRoutes,
    codeChallenge: string,
    state: string,
): Promise<AuthorizationCode | AcrSilentOutcome> {
    const limit = deadline();
    try {
        let response: Response;
        try {
            response = await dependencies.fetch(routes.authorize, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify({ code_challenge: codeChallenge, state }),
                credentials: "same-origin",
                cache: "no-store",
                redirect: "manual",
                signal: limit.signal,
            });
        } catch {
            return failed("unavailable");
        }
        if (response.type === "opaqueredirect") return { kind: "session_ended" };
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            if (limit.signal.aborted) return failed("unavailable");
            body = undefined;
        }
        if (!response.ok) return routeRefusal(response.status, body);
        if (
            !isRecord(body) ||
            typeof body.code !== "string" ||
            body.code === "" ||
            typeof body.state !== "string" ||
            typeof body.iss !== "string"
        ) {
            return failed("invalid_answer");
        }
        return { code: body.code, state: body.state, iss: body.iss };
    } finally {
        limit.clear();
    }
}

/** One attempt, from a tab with a client and no servable token. It ends in one outcome. */
async function attemptAuthorization(
    storage: Storage,
    config: AcrBrowserClientConfig,
    routes: AcrHostRoutes,
    askedBy: AcrPrincipal,
    dropsAtStart: number,
): Promise<AcrSilentOutcome> {
    const server = await discoverAcrAuthorizationServer(config.issuer);
    if (server === null) return failed("unavailable");
    const request: AuthorizationRequest = {
        state: randomBase64Url(32),
        verifier: randomBase64Url(32),
        tabId: tabId(storage),
        issuer: config.issuer,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        tokenEndpoint: server.tokenEndpoint,
        revocationEndpoint: server.revocationEndpoint,
        expiresAt: dependencies.now() + ACR_AUTHORIZATION_TTL_MS,
        askedBy,
        dropsAtStart,
    };
    const answer = await askForCode(routes, await pkceChallenge(request.verifier), request.state);
    return "code" in answer ? completeAuthorization(storage, request, answer) : answer;
}

/** One log line per attempt (CHAOS-12369): its end and an enum reason, nothing else. */
function logAttempt(outcome: AcrSilentOutcome): void {
    const message = "ask-dev acr token store authorization";
    if (outcome.kind === "token") {
        logger.info({ outcome: "authorized" }, message);
        return;
    }
    const reason = outcome.kind === "failed" ? outcome.reason : undefined;
    logger.warn({ outcome: outcome.kind, reason }, message);
}

/**
 * Whether the session has ended, by the endpoint's own answer. A session read gives null for no
 * session and for a failed read alike (`UserMenu` asks the same way), and only the first goes to
 * sign-in: anything but a clear "no session" is unknown, and a person can try again.
 */
async function sessionHasEnded(routes: AcrHostRoutes): Promise<boolean> {
    const limit = deadline();
    try {
        const response = await dependencies.fetch(routes.session, {
            credentials: "same-origin",
            cache: "no-store",
            signal: limit.signal,
        });
        if (!response.ok) return false;
        const body: unknown = await response.json();
        return !isRecord(body) || body.user === undefined || body.user === null;
    } catch {
        return false;
    } finally {
        limit.clear();
    }
}

async function runAuthorization(): Promise<AcrSilentOutcome> {
    const config = dependencies.config();
    const storage = dependencies.storage();
    const { routes } = dependencies;
    if (config === undefined || storage === null || routes === null) return { kind: "off" };
    listenForAcrTabs();
    await checkClone(storage);
    const dropsAtStart = drops;
    const principal = await dependencies.principal();
    // No ACR token for an impersonating session (CHAOS-12306): no metadata read, no route call.
    if (isImpersonating(principal)) {
        // A family stored before the impersonation started goes too (codex r1 on #1680).
        dropTokens(storage);
        logPrincipal("begin", "impersonating");
        const outcome: AcrSilentOutcome = { kind: "impersonating" };
        logAttempt(outcome);
        return outcome;
    }
    // Fail closed (codex r1 on #1714): a code is bound to the session that asked. With no known
    // asker, the exchange could not compare, and another user could get this user's code.
    if (principal === null) {
        const outcome: AcrSilentOutcome = (await sessionHasEnded(routes))
            ? { kind: "session_ended" }
            : failed("principal_unknown");
        logAttempt(outcome);
        return outcome;
    }
    // A caller that read "no token" before an attempt ended: that attempt's token, no request.
    if (held !== null && samePrincipal(held, principal)) {
        const current = servable(config);
        if (current?.kind === "token") return current;
    }
    const outcome = await attemptAuthorization(storage, config, routes, principal, dropsAtStart);
    logAttempt(outcome);
    return outcome;
}

/** A start that left this tab, or why it did not. */
export type AcrRedirectStart =
    | { readonly kind: "redirected" }
    | { readonly kind: "off" }
    | { readonly kind: "impersonating" }
    | { readonly kind: "failed"; readonly reason: AcrAuthorizationFailure };

/** What this tab keeps while it is away at ACR. Nothing here goes in a URL or a log. */
type PendingAuthorization = Omit<AuthorizationRequest, "dropsAtStart">;

function pendingFrom(value: unknown): PendingAuthorization | null {
    if (!isRecord(value)) return null;
    const strings = [
        "state",
        "verifier",
        "tabId",
        "issuer",
        "clientId",
        "redirectUri",
        "tokenEndpoint",
    ];
    if (strings.some((key) => typeof value[key] !== "string")) return null;
    if (typeof value.expiresAt !== "number") return null;
    if (value.revocationEndpoint !== null && typeof value.revocationEndpoint !== "string") {
        return null;
    }
    const askedBy = value.askedBy;
    if (!isRecord(askedBy) || typeof askedBy.userId !== "string") return null;
    if (askedBy.orgId !== null && typeof askedBy.orgId !== "string") return null;
    return value as unknown as PendingAuthorization;
}

/**
 * The redirect path, for a host with no same-origin session route (the Workbench, CHAOS-12106). The
 * tab goes to ACR, the host's web app asks for consent, and ACR sends the tab back to the client's
 * redirect URI, where `completeAcrRedirect` finishes. The rules of the silent step hold: a code is
 * bound to the principal that asked, and the exchange is `completeAuthorization`.
 *
 * One pending authorization per tab: a new start replaces an older one.
 */
export async function beginAcrRedirect(): Promise<AcrRedirectStart> {
    const config = dependencies.config();
    const storage = dependencies.storage();
    if (config === undefined || storage === null) return { kind: "off" };
    listenForAcrTabs();
    await checkClone(storage);
    const principal = await dependencies.principal();
    if (isImpersonating(principal)) {
        dropTokens(storage);
        logPrincipal("begin", "impersonating");
        return { kind: "impersonating" };
    }
    if (principal === null) return { kind: "failed", reason: "principal_unknown" };
    const server = await discoverAcrAuthorizationServer(config.issuer);
    if (server === null) return { kind: "failed", reason: "unavailable" };
    const pending: PendingAuthorization = {
        state: randomBase64Url(32),
        verifier: randomBase64Url(32),
        tabId: tabId(storage),
        issuer: config.issuer,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        tokenEndpoint: server.tokenEndpoint,
        revocationEndpoint: server.revocationEndpoint,
        expiresAt: dependencies.now() + ACR_AUTHORIZATION_TTL_MS,
        askedBy: principal,
    };
    const url = new URL(server.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("code_challenge", await pkceChallenge(pending.verifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", pending.state);
    url.searchParams.set("resource", config.issuer);
    url.searchParams.set("scope", ACR_BROWSER_SCOPE);
    storage.setItem(ACR_PENDING_AUTHORIZATION_KEY, JSON.stringify(pending));
    dependencies.navigate(url.href);
    return { kind: "redirected" };
}

/**
 * Finishes the redirect this tab started, from the callback URL's query. The entry is single use:
 * it is removed before anything else runs. The caller scrubs the URL first. It never rejects.
 */
export async function completeAcrRedirect(search: string): Promise<AcrSilentOutcome> {
    const storage = dependencies.storage();
    if (dependencies.config() === undefined || storage === null) return { kind: "off" };
    listenForAcrTabs();
    // A duplicated tab holds a copy of the entry: the check drops it there, before it is read.
    await checkClone(storage);
    const pending = pendingFrom(readJson(storage, ACR_PENDING_AUTHORIZATION_KEY));
    storage.removeItem(ACR_PENDING_AUTHORIZATION_KEY);
    if (pending === null) return failed("expired");
    const params = new URLSearchParams(search);
    const code = params.get("code");
    if (params.get("error") !== null || code === null || code === "") return failed("refused");
    try {
        return await completeAuthorization(
            storage,
            { ...pending, dropsAtStart: drops },
            {
                code,
                state: params.get("state") ?? "",
                iss: params.get("iss") ?? "",
            },
        );
    } catch {
        return failed("unavailable");
    }
}

/**
 * The silent step (CHAOS-12474; the flow in this file's header). The transport calls it at a user
 * act or after a 401; `getAcrAccessToken()` never does. It does not touch `window.location`: where
 * a session that ended goes is the caller's. Two callers in one tab make one attempt, and share
 * its outcome, a failure too. Each tab holds its own family, so a tab serializes only itself. It
 * never rejects.
 */
export function authorizeAcrSilently(): Promise<AcrSilentOutcome> {
    authorizing ??= runAuthorization()
        .catch((): AcrSilentOutcome => failed("unavailable"))
        .finally(() => {
            authorizing = null;
        });
    return authorizing;
}

function hold(
    token: string,
    expiresIn: number,
    issuer: string,
    clientId: string,
    principal: AcrPrincipal,
): void {
    const issuedAt = dependencies.now();
    const lifetimeMs = expiresIn * 1000;
    held = {
        token,
        issuer,
        clientId,
        issuedAt,
        lifetimeMs,
        expiresAt: issuedAt + lifetimeMs,
        userId: principal.userId,
        orgId: principal.orgId,
    };
}

const AUTHORIZATION_REQUIRED: AcrAccessToken = { kind: "authorization_required" };

/**
 * The held token, while it is for the configured client, before 80 % of its life and not within
 * the skew of its expiry. Otherwise null. The caller has already dropped another principal's.
 */
function servable(config: AcrBrowserClientConfig): AcrAccessToken | null {
    if (held === null || held.issuer !== config.issuer || held.clientId !== config.clientId) {
        return null;
    }
    const now = dependencies.now();
    if (now >= held.issuedAt + ACR_ACCESS_TOKEN_REFRESH_AT * held.lifetimeMs) return null;
    if (now >= held.expiresAt - ACR_ACCESS_TOKEN_SKEW_MS) return null;
    return { kind: "token", token: held.token, issuer: held.issuer };
}

function forClient(family: AcrHeldFamily, config: AcrBrowserClientConfig): boolean {
    return family.issuer === config.issuer && family.clientId === config.clientId;
}

/**
 * One refresh request and its two log lines: sent, then answered (CHAOS-12369). `overtaken` is a
 * clear that landed while the request ran; `lost` is no answer or a 5xx; `unexpected_status` is
 * any other answer the store treats as unavailable (403, 404, 429), retried the same way.
 */
async function refreshAttempt(
    family: AcrHeldFamily,
    attempt: 1 | 2,
    dropsBefore: number,
): Promise<TokenAnswer> {
    const familyId = family.familyId;
    logger.info({ family_id: familyId, attempt }, "ask-dev acr token store refresh sent");
    const answer = await refreshGrant(family);
    let outcome: "ok" | "refused" | "lost" | "unexpected_status" | "invalid" | "overtaken";
    if (drops !== dropsBefore) outcome = "overtaken";
    else if (answer.kind === "ok") outcome = answer.refresh === null ? "invalid" : "ok";
    else if (answer.kind !== "unavailable") outcome = answer.kind;
    else if (answer.status === undefined || answer.status >= 500) outcome = "lost";
    else outcome = "unexpected_status";
    const fields = {
        family_id: familyId,
        outcome,
        ...(answer.status === undefined ? {} : { status: answer.status }),
    };
    const message = "ask-dev acr token store refresh answered";
    if (outcome === "ok") logger.info(fields, message);
    else logger.warn(fields, message);
    return answer;
}

/**
 * Refreshes with the family, under its lock: one refresh at a time per family across the
 * origin's tabs (CHAOS-12305).
 */
function refresh(
    storage: Storage,
    familyId: string,
    config: AcrBrowserClientConfig,
    principal: AcrPrincipal,
): Promise<AcrAccessToken> {
    return dependencies.lock(`${ACR_REFRESH_LOCK_PREFIX}${familyId}`, async () => {
        // Another call in this tab refreshed while this one waited: no request.
        const current = servable(config);
        if (current !== null) return current;
        // Re-read inside the lock: the entry may have rotated or been cleared meanwhile.
        const family = readAcrHeldFamily();
        if (family === null || family.familyId !== familyId || !forClient(family, config)) {
            return AUTHORIZATION_REQUIRED;
        }
        if (!samePrincipal(family, principal)) {
            dropTokens(storage);
            logPrincipal("lock", "mismatch");
            return AUTHORIZATION_REQUIRED;
        }
        const dropsBefore = drops;
        const startedAt = dependencies.now();
        let attempt: 1 | 2 = 1;
        let answer = await refreshAttempt(family, attempt, dropsBefore);
        // A lost response: ACR may have rotated. Its 30 s grace gives the same successor to the
        // same token, so one retry inside 25 s is safe. After that the token is never sent again.
        if (
            answer.kind === "unavailable" &&
            drops === dropsBefore &&
            dependencies.now() - startedAt < ACR_REFRESH_RETRY_WINDOW_MS
        ) {
            attempt = 2;
            answer = await refreshAttempt(family, attempt, dropsBefore);
        }
        // Cleared while in flight (sign-out in another tab): store nothing.
        if (drops !== dropsBefore) {
            logClearRace("refresh");
            return AUTHORIZATION_REQUIRED;
        }
        // Refused (400/401: reuse, revoked, expired), lost twice, too late, or malformed: the
        // family cannot be used again. Fail closed.
        if (answer.kind !== "ok" || answer.refresh === null) {
            const reason =
                attempt === 2
                    ? "retry_failed"
                    : answer.kind === "unavailable"
                      ? "past_grace"
                      : answer.kind === "refused"
                        ? "refused"
                        : "invalid";
            logger.warn({ family_id: familyId, reason }, "ask-dev acr token store family cleared");
            dropTokens(storage);
            return AUTHORIZATION_REQUIRED;
        }
        hold(answer.access, answer.expiresIn, family.issuer, family.clientId, principal);
        const rotated: AcrHeldFamily = { ...family, refreshToken: answer.refresh };
        storage.setItem(ACR_TOKEN_FAMILY_KEY, JSON.stringify(rotated));
        return { kind: "token", token: answer.access, issuer: family.issuer };
    });
}

/**
 * The access token for one ACR call (T14, CHAOS-12104). T14 awaits it right before each call,
 * never caches the token, and has no retry loop. Never a token for another issuer, client or web
 * principal. It never starts an authorization, so a background read cannot (CHAOS-12474): "no
 * token" is the caller's to answer. In order (CHAOS-12305):
 * 1. off without a configured client;
 * 2. once per page load, the clone check;
 * 3. the principal: a mismatch, no session or an impersonating session (CHAOS-12306) drops the
 *    family and the token, and sends nothing;
 * 4. the held token, before 80 % of its life;
 * 5. else a refresh with the family, when one is held;
 * 6. else "authorization required".
 */
export async function getAcrAccessToken(): Promise<AcrAccessToken> {
    const config = dependencies.config();
    if (config === undefined) return { kind: "off" };
    listenForAcrTabs();
    const storage = dependencies.storage();
    if (storage !== null) await checkClone(storage);
    const principal = await dependencies.principal();
    const family = readAcrHeldFamily();
    if (
        principal === null ||
        isImpersonating(principal) ||
        (held !== null && !samePrincipal(held, principal)) ||
        (family !== null && !samePrincipal(family, principal))
    ) {
        dropTokens(storage);
        logPrincipal("before", principalReason(principal));
        return AUTHORIZATION_REQUIRED;
    }
    const current = servable(config);
    if (current !== null) return current;
    if (storage === null || family === null || !forClient(family, config)) {
        return AUTHORIZATION_REQUIRED;
    }
    const answer = await refresh(storage, family.familyId, config, principal);
    if (answer.kind !== "token") return answer;
    // The web session may have changed while the refresh ran (an org switch, a sign-out): the token
    // goes only to the principal it was refreshed for (codex r1 on #1676).
    const dropsBefore = drops;
    const after = await dependencies.principal();
    if (after === null || isImpersonating(after) || !samePrincipal(after, principal)) {
        dropTokens(storage);
        logPrincipal("after_refresh", principalReason(after));
        return AUTHORIZATION_REQUIRED;
    }
    // A clear while that check ran (sign-out, a clone) wins: the token is not given out (codex r2).
    if (drops !== dropsBefore) {
        logClearRace("after_refresh_check");
        return AUTHORIZATION_REQUIRED;
    }
    return answer;
}

/**
 * T14: ACR answered 401 `invalid_token` for `token` on a data call. Drops the held token only if
 * it is that token, so a newer one stays. Keeps the family: the next `getAcrAccessToken()`
 * refreshes (CHAOS-12305), and with no family the transport makes its one silent attempt.
 */
export function reportAcrTokenRejected(token: string): void {
    if (held !== null && held.token === token) held = null;
}

/**
 * Sign-out step 3: clears this tab's token state and tells the origin's other tabs to clear
 * theirs (CHAOS-12305).
 */
export function clearAcrTokensInAllTabs(): void {
    listenForAcrTabs();
    dropTokens(dependencies.storage());
    dependencies.channel()?.post({ type: "clear" });
}

/**
 * The family this tab holds, from `sessionStorage` only (sync, any page). `null` when none, or
 * for a v1 entry, which names no principal. It does not check the principal: the sign-out hook
 * revokes the family whoever is signed in.
 */
export function readAcrHeldFamily(): AcrHeldFamily | null {
    const storage = dependencies.storage();
    if (storage === null) return null;
    const value = readJson(storage, ACR_TOKEN_FAMILY_KEY);
    if (!isRecord(value) || value.v !== 2) return null;
    if (typeof value.refreshToken !== "string" || !REFRESH_TOKEN.test(value.refreshToken))
        return null;
    if (typeof value.familyId !== "string" || !FAMILY_ID.test(value.familyId)) return null;
    // Only the configured client's family, with its endpoints on that issuer's origin, as discovery
    // checked them: a family edited in storage never sends a refresh token elsewhere (codex r1 on
    // #1676). With no configured client there is no family to use or revoke.
    const config = dependencies.config();
    if (config === undefined) return null;
    if (value.issuer !== config.issuer || value.clientId !== config.clientId) return null;
    if (endpointOn(config.issuer, value.tokenEndpoint) !== value.tokenEndpoint) return null;
    if (
        value.revocationEndpoint !== null &&
        endpointOn(config.issuer, value.revocationEndpoint) !== value.revocationEndpoint
    ) {
        return null;
    }
    if (typeof value.userId !== "string" || value.userId === "") return null;
    if (value.orgId !== null && typeof value.orgId !== "string") return null;
    return value as unknown as AcrHeldFamily;
}
