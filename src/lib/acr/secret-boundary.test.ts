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

/** What this app must not name anywhere: the words of the old key, identity and route. */
const IDENTITY = FORBIDDEN.slice(0, 7);
const AROUND_THE_SOURCE = [
    ...["tests", "scripts", "docs", "ci", ".github"].flatMap((name) =>
        filesUnder(path.join(ROOT, name)),
    ),
    path.join(ROOT, "README.md"),
    path.join(ROOT, "AGENTS.md"),
    path.join(ROOT, ".env.example"),
];
/** The local ACR's own config for web's assertions: it is ACR's, and this app holds none of it. */
const LOCAL_ACR_ENV = path.join("scripts", "dev-launch.sh");

describe("no key, identity or old route around the source", () => {
    it("reads those files, so a pass is not an empty scan", () => {
        expect(AROUND_THE_SOURCE.length).toBeGreaterThan(20);
        expect(AROUND_THE_SOURCE).toContain(path.join(ROOT, "README.md"));
        expect(AROUND_THE_SOURCE).toContain(path.join(ROOT, "scripts", "dev-launch.sh"));
    });

    it.each(IDENTITY)("no test, script, doc or example holds %s", (word) => {
        const holders = AROUND_THE_SOURCE.map((file) => path.relative(ROOT, file))
            .filter((relative) => relative !== LOCAL_ACR_ENV || word !== "ACR_WEB_ASSERTION")
            .filter((relative) => readFileSync(path.join(ROOT, relative), "utf8").includes(word));
        expect(holders).toEqual([]);
    });
});

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
