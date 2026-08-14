import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as investigationsRoute from "@/app/api/investigations/route";

/**
 * The server-runtime boundary the ACR client depends on.
 *
 * Two things hold it up, and neither announces itself if it changes:
 *
 *   - `Buffer.byteLength` is Node-only, so the response cap silently stops
 *     measuring bytes on an edge runtime;
 *   - the Ed25519 signing key and `node:crypto` are Node-only too, so the whole
 *     server hop depends on this route staying on the Node runtime.
 *
 * A move to the edge would not fail loudly — it would degrade. That is the
 * fails-toward-fine shape, so it is pinned rather than left as a convention.
 */
describe("the investigations route runs on the Node runtime", () => {
    it("declares runtime = nodejs", () => {
        expect(investigationsRoute.runtime).toBe("nodejs");
    });

    /**
     * `server-only` throws at build time if a module is pulled into a client
     * bundle, which is what keeps the signing key off the browser. Asserted on
     * the source because the guard is the IMPORT itself — under Vitest the
     * package is stubbed, so importing the module proves nothing.
     */
    it("keeps the ACR client and config server-only", () => {
        for (const relative of ["client.ts", "config.ts", "assertion.ts"]) {
            const source = readFileSync(path.join(import.meta.dirname, relative), "utf8");
            expect(source, relative).toMatch(/^import "server-only";/mu);
        }
    });
});
