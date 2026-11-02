import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * CHAOS-12636: a navigation the layout checks can trust. The page's one stylesheet is render
 * blocking, but a stylesheet request that FAILS does not block `load`: the page then draws with no
 * styles, and a phone-width table sits in the document flow (`scrollWidth - innerWidth` read 76).
 * On a shared CI host Chromium aborts in-flight requests with `net::ERR_NETWORK_CHANGED` whenever
 * the host's interfaces change, and other jobs' containers change them all the time (traced on
 * bigboy: 10 of 130 phone runs, every one an aborted stylesheet).
 *
 * So: go to `path`; while a stylesheet request failed, reload, at most `MAX_RELOADS` times, and
 * record each as an annotation (a retry is a finding, never silent); then require the real signal,
 * every `<head>` stylesheet with readable rules. A failure after the last reload fails the test with
 * the browser's own error text. No timeout is raised: the signal is polled for the default `expect`
 * time.
 */
export async function gotoStyled(page: Page, path: string): Promise<void> {
    const failed: string[] = [];
    const onFailed = (request: Request) => {
        if (request.resourceType() !== "stylesheet") return;
        failed.push(
            `${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "failed"}`,
        );
    };
    page.on("requestfailed", onFailed);
    try {
        await page.goto(path);
        // On the shared host about one stylesheet load in twelve was aborted, so a reload can be
        // aborted too (seen once while proving this helper). Two reloads at most, each recorded.
        for (let reload = 1; failed.length > 0 && reload <= MAX_RELOADS; reload += 1) {
            test.info().annotations.push({
                type: "stylesheet-retry",
                description: `${new Date().toISOString()} ${path} reload ${String(reload)}: ${failed.join("; ")}`,
            });
            failed.length = 0;
            await page.reload();
        }
        await expect
            .poll(() => (failed.length > 0 ? failed : unstyledSheets(page)), {
                message: "every stylesheet in <head> is applied",
            })
            .toEqual([]);
    } finally {
        page.off("requestfailed", onFailed);
    }
}

/** How many times a navigation whose stylesheet failed is loaded again before the test fails. */
const MAX_RELOADS = 2;

/**
 * Each `<head>` stylesheet the page has not applied (no sheet, or no readable rules). A page with no
 * stylesheet at all is not "nothing missing": the check that did not happen fails.
 */
export function unstyledSheets(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const links = [
            ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        ];
        if (links.length === 0) return ["(no stylesheet in <head>)"];
        return links.flatMap((link) => {
            let rules = 0;
            try {
                rules = link.sheet?.cssRules.length ?? 0;
            } catch {
                rules = 0;
            }
            return rules > 0 ? [] : [link.getAttribute("href") ?? "(no href)"];
        });
    });
}
