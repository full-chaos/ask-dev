import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * CHAOS-12106: this app is a browser OAuth client of ACR. No key, assertion or identity of its own
 * may remain in the bundle or on the server. The words below name what was removed; a file that
 * brings one back fails here, whichever file it is.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const SELF = path.join("src", "lib", "acr", "secret-boundary.test.ts");

const FORBIDDEN = [
    "ACR_WEB_ASSERTION",
    "ACR_ORG_ID",
    "ACR_REPOSITORY_SCOPES",
    "ACR_SUBJECT",
    "X-ACR-Web-Assertion",
    "signWebAssertion",
    "/api/investigations",
    "server-only",
    "node:crypto",
] as const;

/**
 * The shared client's own test helper signs nothing for ACR: it makes PKCE material for a fake
 * authorization server, in a test, and is never bundled.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
    "node:crypto": [path.join("src", "acr-client", "__tests__") + path.sep],
};

function filesUnder(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const full = path.join(directory, name);
        return statSync(full).isDirectory() ? filesUnder(full) : [full];
    });
}

const files = [...filesUnder(path.join(ROOT, "src")), path.join(ROOT, "package.json")].filter(
    (file) => path.relative(ROOT, file) !== SELF,
);

describe("no secret, assertion or server identity remains", () => {
    it("reads the whole tree, so a pass is not an empty scan", () => {
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain(path.join(ROOT, "package.json"));
        expect(files).toContain(path.join(ROOT, "src", "lib", "acr", "browser-host.ts"));
    });

    it("does not read itself", () => {
        expect(files.map((file) => path.relative(ROOT, file))).not.toContain(SELF);
    });

    it.each(FORBIDDEN)("no file under src/ or package.json holds %s", (word) => {
        const allowed = ALLOWED[word] ?? [];
        const holders = files
            .map((file) => path.relative(ROOT, file))
            .filter((relative) => !allowed.some((prefix) => relative.startsWith(prefix)))
            .filter((relative) => readFileSync(path.join(ROOT, relative), "utf8").includes(word));
        expect(holders).toEqual([]);
    });

    it("has no server route directory", () => {
        expect(existsSync(path.join(ROOT, "src", "app", "api"))).toBe(false);
    });
});
