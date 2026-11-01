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
const rules = (root) => checkRenderGraph({ root, minFiles: 1 }).breaks.map((item) => item.rule);

describe("the render entry (CHAOS-12381)", () => {
    it("reaches the shell and the answer view, and breaks no rule", () => {
        // The default threshold is the contract: a walk that reaches fewer than 50 files fails.
        const { files, breaks } = checkRenderGraph({ root: repositoryRoot });
        expect(breaks).toEqual([]);
        expect(files).toContain("src/components/chat/AskDevChat.tsx");
        expect(files).toContain("src/components/DeterministicAnswerView.tsx");
        // ask-dev's server code and standalone chrome are not part of it.
        expect(files.filter((file) => file.startsWith("src/lib/acr/client"))).toEqual([]);
        expect(files).not.toContain("src/components/shell/AppHeader.tsx");
    });

    it("names the files a host loads at run time: a type edge alone loads nothing", () => {
        const root = tree({
            [ENTRY]:
                'import { a } from "../a";\nimport type { B } from "../b";\nexport const x = a;\n',
            "src/a.ts": "export const a = 1;\n",
            "src/b.ts": "export type B = string;\n",
        });
        const { files, runtimeFiles } = checkRenderGraph({ root, minFiles: 1 });
        expect(files).toContain("src/b.ts");
        expect(runtimeFiles).toEqual([ENTRY, "src/a.ts"].sort());
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

    // The edges an import declaration does not show (from a void codex round on #116, reproduced).
    it("require(), import = require(), a JSX import-source pragma and triple-slash references are edges", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'const fs = require("node:fs");\nexport const A = fs;\n',
                }),
            ),
        ).toEqual(["server"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import fs = require("node:fs");\nexport const A = fs;\n',
                }),
            ),
        ).toEqual(["server"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": "/** @jsxImportSource next */\nexport const A = 1;\n",
                }),
            ),
        ).toEqual(["framework"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": '/// <reference path="./app/page.tsx" />\nexport const A = 1;\n',
                    "src/app/page.tsx": "export const P = 1;\n",
                }),
            ),
        ).toEqual(["outside"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": '/// <reference types="node" />\nexport const A = 1;\n',
                }),
            ),
        ).toEqual(["server"]);
    });

    // codex r1 on #116: three false passes, reproduced.
    it("the default threshold is 50 files: a two-file graph fails with the defaults", () => {
        const root = tree(clean);
        expect(checkRenderGraph({ root }).breaks.map((item) => item.rule)).toEqual([
            "too_few_files",
        ]);
    });

    it("require() and import() count however many arguments follow the specifier", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'const fs = require("node:fs", {});\nexport const A = fs;\n',
                }),
            ),
        ).toEqual(["server"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'export const A = () => import("next/link", { with: {} });\n',
                }),
            ),
        ).toEqual(["framework"]);
    });

    it("a triple-slash types reference meets every package rule (next is framework)", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": '/// <reference types="next" />\nexport const A = 1;\n',
                }),
            ),
        ).toEqual(["framework"]);
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": '/// <reference types="server-only" />\nexport const A = 1;\n',
                }),
            ),
        ).toEqual(["server"]);
    });

    it("css: a stylesheet import in the render (a host imports ask-dev.css once, from the export)", () => {
        expect(
            rules(
                tree({
                    ...clean,
                    "src/a.tsx": 'import "./a.css";\nexport const A = 1;\n',
                    "src/a.css": ".a{}\n",
                }),
            ),
        ).toEqual(["css"]);
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
