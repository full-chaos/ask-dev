import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkRenderGraph, importsOf } from "../../../scripts/render-entry-graph.mjs";

/**
 * CHAOS-12540: a host compiles this client from source, so the rules of the render entry hold for
 * it too: no `@/`, no framework, no server code. `next-auth` is the client's own rule: a host reads
 * its session and gives it through `configureAcrAuth`.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");

describe.each([
    ["src/acr-client/index.ts", 10],
    ["src/acr-client/config.ts", 1],
])("the entry %s", (entry, minFiles) => {
    const graph = checkRenderGraph({ root: ROOT, entry, minFiles });

    it("reaches its files and breaks no rule", () => {
        expect(graph.files.length).toBeGreaterThanOrEqual(minFiles);
        expect(graph.breaks).toEqual([]);
    });

    it("reaches no next-auth", () => {
        const specifiers = graph.files.flatMap((file) =>
            file.endsWith(".json")
                ? []
                : importsOf(file, readFileSync(path.join(ROOT, file), "utf8")).map(
                      (found) => found.specifier,
                  ),
        );
        expect(specifiers.length).toBeGreaterThanOrEqual(minFiles - 1);
        expect(specifiers.filter((specifier) => specifier.startsWith("next-auth"))).toEqual([]);
    });
});

describe("the package exports", () => {
    it("name both entries", () => {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
            exports: Record<string, string>;
        };
        expect(manifest.exports["./acr-client"]).toBe("./src/acr-client/index.ts");
        expect(manifest.exports["./acr-client/config"]).toBe("./src/acr-client/config.ts");
    });
});

describe("the server entry", () => {
    it("is one file, so a host's server code loads no client code", () => {
        const graph = checkRenderGraph({
            root: ROOT,
            entry: "src/acr-client/config.ts",
            minFiles: 1,
        });
        expect(graph.files).toEqual(["src/acr-client/config.ts"]);
    });
});
