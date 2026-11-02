import { expect, test as base, type Page } from "@playwright/test";

import { resultStream } from "./acr-events.mjs";

/**
 * Sign-in for the e2e specs (CHAOS-12106). The app is a browser OAuth client of ACR: with no token,
 * the first ask sends the tab to ACR's /authorize and back to the page it came from, and the
 * question that caused it is not sent (the page reloads, the draft is gone). The family of
 * refresh tokens stays in the tab's `sessionStorage`, so every later load of the origin gets its
 * token with no redirect.
 *
 * `test` signs in before each spec body, on the spec's own `baseURL`, with the Workbench's form
 * and a question that never goes out. A spec on another origin calls `signIn` for it. The sign-in
 * spec itself uses `@playwright/test` directly, since the redirect is what it proves.
 */

/** The shared client's family key (`ACR_TOKEN_FAMILY_KEY`), duplicated: a spec cannot import `src/`. */
const FAMILY_KEY = "ask-dev:acr-family";

const INVESTIGATIONS = "**/api/v1/context-fabric/investigations";

async function held(page: Page): Promise<boolean> {
    try {
        return await page.evaluate(
            (key) =>
                window.sessionStorage.getItem(key) !== null &&
                window.location.pathname === "/workbench",
            FAMILY_KEY,
        );
    } catch {
        // The page is between documents: the redirect is still on its way.
        return false;
    }
}

/** Goes through the redirect once, on `origin`, and ends on the Workbench with a family held. */
export async function signIn(page: Page, origin: string): Promise<void> {
    await page.goto(`${origin}/workbench`);
    if (await held(page)) return;
    await page.getByLabel("Ask Context Fabric").fill("Sign me in");
    await page.getByRole("button", { name: "Investigate" }).click();
    await expect.poll(() => held(page), { timeout: 30_000 }).toBe(true);
}

/** The ACR investigation call fails at the network, as a dead service does. */
export async function abortInvestigations(page: Page): Promise<void> {
    await page.route(INVESTIGATIONS, (route) =>
        // The preflight is the fake ACR's own to answer.
        route.request().method() === "OPTIONS" ? route.fallback() : route.abort("failed"),
    );
}

export async function restoreInvestigations(page: Page): Promise<void> {
    await page.unroute(INVESTIGATIONS);
}

/** ACR answers every investigation with this result, as an event stream. */
export async function answerInvestigations(page: Page, result: unknown) {
    await page.route(INVESTIGATIONS, (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fallback();
        const headers = request.headers();
        return route.fulfill({
            status: 200,
            headers: {
                "content-type": "text/event-stream",
                "access-control-allow-origin": headers["origin"] ?? "*",
            },
            body: resultStream({
                result: result as { result_id: string },
                submissionId: headers["x-acr-submission-id"],
                threadId: headers["x-acr-thread-id"],
            }),
        });
    });
}

export const test = base.extend<{ signedIn: undefined }>({
    signedIn: [
        async ({ page, baseURL }, use) => {
            if (baseURL === undefined) throw new Error("the spec has no baseURL to sign in on");
            await signIn(page, new URL(baseURL).origin);
            await use(undefined);
        },
        { auto: true },
    ],
});

export { expect };
export type { Page };
