import { expect, gotoStyled, test } from "./support/signed-in";
import { unstyledSheets } from "./support/styled";

// CHAOS-12636: a layout check reads a page with its stylesheet applied, never a page whose one
// stylesheet request failed. The failure is planted the way the shared CI host made it happen: the
// stylesheet request aborts at the network (there it was `net::ERR_NETWORK_CHANGED`).

const STYLESHEET = /\/_next\/static\/.*\.css$/u;
const PHONE = { width: 390, height: 844 };

test.describe("a navigation the layout checks can trust", () => {
    test("a page.goto whose stylesheet request fails draws unstyled: the harm, held", async ({
        page,
    }) => {
        await page.route(STYLESHEET, (route) => route.abort("internetdisconnected"));
        await page.setViewportSize(PHONE);
        await page.goto("/");
        // `load` came, the page drew, and nothing is applied.
        await expect.poll(() => unstyledSheets(page)).not.toEqual([]);
    });

    test("gotoStyled loads a stylesheet that failed once again, and records the retry", async ({
        page,
    }, testInfo) => {
        let aborted = 0;
        await page.route(STYLESHEET, (route) => {
            if (aborted > 0) return route.fallback();
            aborted += 1;
            return route.abort("internetdisconnected");
        });
        await page.setViewportSize(PHONE);
        await gotoStyled(page, "/");
        expect(aborted).toBe(1);
        expect(await unstyledSheets(page)).toEqual([]);
        const retries = testInfo.annotations.filter((note) => note.type === "stylesheet-retry");
        expect(retries).toHaveLength(1);
        expect(retries[0]!.description).toContain("net::ERR_INTERNET_DISCONNECTED");
        // Styled, the page does not scroll sideways at phone width.
        const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(sideways).toBe(0);
    });

    test("gotoStyled fails, with the browser's error, when the stylesheet fails twice", async ({
        page,
    }) => {
        await page.route(STYLESHEET, (route) => route.abort("internetdisconnected"));
        await page.setViewportSize(PHONE);
        const failure = await gotoStyled(page, "/").then(
            () => "passed",
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        expect(failure).toContain("net::ERR_INTERNET_DISCONNECTED");
    });

    test("gotoStyled on a healthy page changes nothing and records no retry", async ({
        page,
    }, testInfo) => {
        await page.setViewportSize(PHONE);
        await gotoStyled(page, "/");
        expect(await unstyledSheets(page)).toEqual([]);
        expect(testInfo.annotations.filter((note) => note.type === "stylesheet-retry")).toEqual(
            [],
        );
    });
});
