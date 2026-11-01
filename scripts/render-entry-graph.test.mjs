import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkRenderGraph, importsOf } from "./render-entry-graph.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A small tree: `files` maps a path under the root to its text. */
function tree(files) {
    const root = mkdtempSync(join(tmpdir(), "render-entry-"));
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

const ENTRY = "src/render/index.ts";
const rules = (root) => checkRenderGraph({ root }).breaks.map((item) => item.rule);

describe("the render entry (CHAOS-12381)", () => {
    it("reaches the shell and the answer view, and breaks no rule", () => {
        const { files, breaks } = checkRenderGraph({ root: repositoryRoot, minFiles: 50 });
        expect(breaks).toEqual([]);
        expect(files).toContain("src/components/chat/AskDevChat.tsx");
        expect(files).toContain("src/components/DeterministicAnswerView.tsx");
        // ask-dev's server code and standalone chrome are not part of it.
        expect(files.filter((file) => file.startsWith("src/lib/acr/client"))).toEqual([]);
        expect(files).not.toContain("src/components/shell/AppHeader.tsx");
    });

    it("package.json exports the entry and the stylesheet under the package name", async () => {
        const { readFileSync } = await import("node:fs");
        const manifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
        expect(manifest.name).toBe("@full-chaos/ask-dev");
        expect(manifest.exports).toMatchObject({
            "./render": "./src/render/index.ts",
            "./ask-dev.css": "./src/app/ask-dev.css",
        });
    });
});

describe("the guard names each break (a plant per rule)", () => {
    const clean = { [ENTRY]: 'export { A } from "../a";\n', "src/a.tsx": "export const A = 1;\n" };

    it("passes a clean tree", () => {
        expect(rules(tree(clean))).toEqual([]);
    });

    it("alias: an @/ import, at any depth", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import { B } from "@/b";\nexport const A = B;\n',
                    "src/b.ts": "export const B = 1;\n",
                }),
            ),
        ).toEqual(["alias"]);
    });

    it("framework: next and next/*", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import Link from "next/link";\nexport const A = Link;\n',
                }),
            ),
        ).toEqual(["framework"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import next from "next";\nexport const A = next;\n',
                }),
            ),
        ).toEqual(["framework"]);
    });

    it("server: server-only and Node built-ins", () => {
        expect(
            rules(tree({ ...clean, "src/a.tsx": 'import "server-only";\nexport const A = 1;\n' })),
        ).toEqual(["server"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx":
                        'import { readFileSync } from "node:fs";\nexport const A = readFileSync;\n',
                }),
            ),
        ).toEqual(["server"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import path from "path";\nexport const A = path;\n',
                }),
            ),
        ).toEqual(["server"]);
    });

    it("workbench: the Workbench library at run time; a type-only edge to it is allowed", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx":
                        'import { x } from "@openuidev/react-lang";\nexport const A = x;\n',
                }),
            ),
        ).toEqual(["workbench"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx":
                        'import type { T } from "./w";\nexport const A = 1 as unknown as T;\n',
                    "src/w.ts":
                        'import { x } from "@openuidev/react-lang";\nexport type T = typeof x;\n',
                }),
            ),
        ).toEqual([]);
        // An inline `type` specifier can still load the module: it counts as a value edge.
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx":
                        'import { type T } from "./w";\nexport const A = 1 as unknown as T;\n',
                    "src/w.ts":
                        'import { x } from "@openuidev/react-lang";\nexport type T = typeof x;\n',
                }),
            ),
        ).toEqual(["workbench"]);
    });

    it("outside: a file under src/app, or outside src", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'export { R } from "./app/route";\n',
                    "src/app/route.ts": "export const R = 1;\n",
                }),
            ),
        ).toEqual(["outside"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'export { S } from "../scripts/s";\n',
                    "scripts/s.ts": "export const S = 1;\n",
                }),
            ),
        ).toEqual(["outside"]);
    });

    it("unresolved: a relative import that names no file", () => {
        expect(rules(tree({ ...clean, "src/a.tsx": 'export { G } from "./gone";\n' }))).toEqual([
            "unresolved",
        ]);
    });

    it("cannot pass by default: no entry, or too few files", () => {
        expect(rules(tree({ "src/a.tsx": "export const A = 1;\n" }))).toEqual(["missing_entry"]);
        expect(
            checkRenderGraph({ root: tree(clean), minFiles: 5 }).breaks.map((item) => item.rule),
        ).toEqual(["too_few_files"]);
    });

    it("reads type-only imports and exports, side-effect imports and dynamic imports", () => {
        const found = importsOf(
            "x.ts",
            'import type { A } from "./a";\nimport "./b";\nexport type { C } from "./c";\nexport { D } from "./d";\nconst e = () => import("./e");\ntype F = import("./f").F;\n',
        );
        expect(found).toEqual([
            { specifier: "./a", typeOnly: true },
            { specifier: "./b", typeOnly: false },
            { specifier: "./c", typeOnly: true },
            { specifier: "./d", typeOnly: false },
            { specifier: "./e", typeOnly: false },
            { specifier: "./f", typeOnly: true },
        ]);
    });
});
