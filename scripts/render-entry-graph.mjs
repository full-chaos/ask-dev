/**
 * The guard of ask-dev's render entry (CHAOS-12381; CHAOS-12378 part A).
 *
 * A host (web) imports ask-dev's render from `src/render/index.ts` and compiles its source. Every
 * file that entry reaches, through a value import or a type import, is therefore compiled or
 * type-checked in the host. This walks that graph with the TypeScript parser and names each break:
 *
 * - `alias`: an `@/` import. A host resolves `@/` against its own tree (web maps `@/*` to its
 *   `src/*` too, and both repos hold files such as `@/lib/acr/errors.ts`).
 * - `framework`: `next` or `next/*`. The render runs inside any React host.
 * - `server`: `server-only`, or a Node built-in. The render is client code.
 * - `workbench`: `@openuidev/react-lang` reached at run time (a type-only edge is erased by the
 *   compiler and loads nothing). It belongs to the Workbench, not to the render.
 * - `outside`: a reached file outside `src/`, or under `src/app/` (routes and server code).
 * - `css`: a stylesheet import. The stylesheet is exported on its own (`./ask-dev.css`) and a host
 *   imports it once; a component that imports CSS would put a stylesheet into the host's graph.
 * - `unresolved`: a relative import that names no file.
 *
 * Edges are read from import and export declarations (`export *` included), `import x =
 * require()`, `require()` and `import()` calls, `import("x")` types, the `@jsxImportSource`
 * pragma (an edge to its `jsx-runtime`), and triple-slash references (`path` to a file, `types`
 * to a package; `types="node"` is a server break).
 *
 * A walk that cannot measure fails: a missing entry, or one that reaches fewer files than
 * `minFiles` (50 by default: the render reaches 67 today), is a break too.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"];
const INDEXES = ["/index.ts", "/index.tsx", "/index.js"];
const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const WORKBENCH = new Set(["@openuidev/react-lang"]);

/** Every import of one file: `{ specifier, typeOnly }`. */
export function importsOf(fileName, text) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const found = [];
    // The JSX runtime a pragma names is imported by the compiler.
    for (const match of text.matchAll(/@jsxImportSource\s+([^\s*]+)/gu)) {
        found.push({ specifier: `${match[1]}/jsx-runtime`, typeOnly: false });
    }
    for (const reference of source.referencedFiles) {
        found.push({
            specifier: reference.fileName.startsWith(".")
                ? reference.fileName
                : `./${reference.fileName}`,
            typeOnly: true,
        });
    }
    for (const reference of source.typeReferenceDirectives) {
        found.push({ specifier: reference.fileName, typeOnly: true, typesReference: true });
    }
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            // Only `import type …` is erased whole. `import { type A } from "x"` can keep a bare
            // `import "x"` (verbatimModuleSyntax), so it counts as a value edge.
            const typeOnly = node.importClause?.isTypeOnly === true;
            found.push({ specifier: node.moduleSpecifier.text, typeOnly });
        } else if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            found.push({
                specifier: node.moduleReference.expression.text,
                typeOnly: node.isTypeOnly,
            });
        } else if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "require" &&
            node.arguments.length >= 1 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            found.push({ specifier: node.arguments[0].text, typeOnly: false });
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length >= 1 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            found.push({ specifier: node.arguments[0].text, typeOnly: false });
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            const literal = node.argument.literal;
            if (ts.isStringLiteral(literal))
                found.push({ specifier: literal.text, typeOnly: true });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function resolveFile(base) {
    for (const extension of EXTENSIONS) {
        const path = base + extension;
        if (existsSync(path) && statSync(path).isFile()) return path;
    }
    for (const index of INDEXES) {
        const path = base + index;
        if (existsSync(path) && statSync(path).isFile()) return path;
    }
    return null;
}

const packageOf = (specifier) =>
    specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];

/**
 * Walks the graph from `entry` (relative to `root`). Returns the reached files and every break.
 * @returns {{ files: string[], breaks: { rule: string, file: string, specifier?: string }[] }}
 */
export function checkRenderGraph({ root, entry = "src/render/index.ts", minFiles = 50 }) {
    const breaks = [];
    const entryPath = resolve(root, entry);
    if (!existsSync(entryPath)) {
        return { files: [], breaks: [{ rule: "missing_entry", file: entry }] };
    }
    const src = join(resolve(root), "src") + sep;
    const app = join(src, "app") + sep;
    // [file, reached at run time]: a file reached only through type edges is still checked for
    // every rule but `workbench`.
    const runtime = new Map();
    const queue = [[entryPath, true]];
    while (queue.length > 0) {
        const [file, live] = queue.shift();
        if (runtime.has(file) && (runtime.get(file) || !live)) continue;
        runtime.set(file, live);
        const name = relative(root, file);
        if (!file.startsWith(src) || file.startsWith(app))
            breaks.push({ rule: "outside", file: name });
        if (file.endsWith(".json")) continue;
        for (const { specifier, typeOnly, typesReference } of importsOf(
            file,
            readFileSync(file, "utf8"),
        )) {
            const reachesAtRuntime = live && !typeOnly;
            if (typesReference && specifier === "node") {
                breaks.push({ rule: "server", file: name, specifier: "types:node" });
                continue;
            }
            if (/\.(css|scss|sass|less)$/u.test(specifier)) {
                breaks.push({ rule: "css", file: name, specifier });
                continue;
            }
            if (specifier.startsWith("@/")) {
                breaks.push({ rule: "alias", file: name, specifier });
                // Walk on, so that one alias does not hide the files behind it.
                const target = resolveFile(join(root, "src", specifier.slice(2)));
                if (target !== null) queue.push([target, reachesAtRuntime]);
                continue;
            }
            if (specifier.startsWith(".")) {
                const target = resolveFile(resolve(dirname(file), specifier));
                if (target === null) breaks.push({ rule: "unresolved", file: name, specifier });
                else queue.push([target, reachesAtRuntime]);
                continue;
            }
            // A types reference names a package: the package rules below hold for it too.
            const pkg = packageOf(specifier);
            if (pkg === "next") breaks.push({ rule: "framework", file: name, specifier });
            else if (
                pkg === "server-only" ||
                NODE_BUILTINS.has(specifier) ||
                NODE_BUILTINS.has(pkg)
            ) {
                breaks.push({ rule: "server", file: name, specifier });
            } else if (WORKBENCH.has(pkg) && reachesAtRuntime) {
                breaks.push({ rule: "workbench", file: name, specifier });
            }
        }
    }
    const files = [...runtime.keys()].map((file) => relative(root, file)).sort();
    if (files.length < minFiles) breaks.push({ rule: "too_few_files", file: entry });
    // A file first reached through a type edge is walked again when a value edge reaches it: one
    // break is reported once.
    const unique = new Map(
        breaks.map((item) => [`${item.rule}|${item.file}|${item.specifier ?? ""}`, item]),
    );
    return { files, breaks: [...unique.values()] };
}
