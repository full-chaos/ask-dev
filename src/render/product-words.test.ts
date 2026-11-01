import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { checkRenderGraph } from "../../scripts/render-entry-graph.mjs";

/**
 * CHAOS-12406: no string the render writes names an internal service or a ticket on screen, and no
 * raw failure code reaches a user. This reads the source of every file a host loads at run time,
 * plus the files that write `failure.message`, with the TypeScript parser.
 *
 * Exemptions go by AST position, never by a word list: a comment is not a string, and an import
 * path, a type, a log call, an object key, a `data-*`/`className`/test id value, a failure's `code`
 * and an operand of `===` or `case` never reach the DOM. The body of a closed fold (`<Details>`, or
 * `<details>` with no `open`) is allowed: raw data belongs there (CHAOS-4690). Its summary stays on
 * screen, so it is read.
 *
 * Served text is not here: it is data at run time, and it passes whatever it says.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");

/** Outside the runtime graph, but `failure.message` strings written here reach a user. */
const FAILURE_MESSAGE_FILES = [
    "src/lib/acr/errors.ts",
    "src/lib/acr/client.ts",
    "src/app/api/investigations/route.ts",
];

/** What a raw field is called: read straight into a user's view, it shows the raw value. */
const RAW_FIELDS = new Set(["code", "details", "httpStatus", "upstreamCode"]);

/** Ids a component reads into a view. A `lib/` file builds keys and request bodies from them. */
const RAW_ID_FIELDS = new Set([
    "applied_value",
    "canonical_id",
    "disposition",
    "kind",
    "prior_result_id",
    "provenance",
    "receipt_id",
    "state",
]);

const FORBIDDEN = [
    /\bACR\b/u,
    /Context Fabric/u,
    /^raw field: /u,
    /Workbench/u,
    /CHAOS-\d+/u,
    /acr_[a-z_]+/u,
    /HTTP \d/u,
] as const;

type Literal = { readonly line: number; readonly text: string };

const EXEMPT_JSX_ATTRIBUTE = (name: string): boolean =>
    name === "className" || name === "key" || name === "testId" || name.startsWith("data-");

function isConsoleCall(node: ts.Node): boolean {
    return (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "console"
    );
}

/** The failure-code vocabulary: machine tokens, rendered only as `data-failure-code`. */
function isFailureCodeTable(node: ts.Node): boolean {
    return (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "workbenchFailureCodes"
    );
}

/** A JSX element's tag, as written. */
function jsxTag(node: ts.JsxElement): string {
    return node.openingElement.tagName.getText();
}

/** A JSX value a user reads: a child, or a text attribute. A prop or a key is not read here. */
function reachesTheText(node: ts.JsxExpression): boolean {
    if (!ts.isJsxAttribute(node.parent)) return true;
    return ["aria-label", "alt", "placeholder", "title"].includes(node.parent.name.getText());
}

/** A fold a user has to open: `<Details>`, which always starts closed, or a plain `<details>`. */
function isClosedFold(node: ts.JsxElement): boolean {
    const tag = jsxTag(node);
    if (tag === "Details") return true;
    if (tag !== "details") return false;
    return !node.openingElement.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "open",
    );
}

function isEquality(node: ts.BinaryExpression): boolean {
    const { kind } = node.operatorToken;
    return (
        kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    );
}

/** Every string literal, template part and JSX text a user could reach, with its line. */
function visibleLiterals(fileName: string, text: string): readonly Literal[] {
    const scriptKind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
    const found: Literal[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isImportDeclaration(node) ||
            ts.isExportDeclaration(node) ||
            ts.isImportEqualsDeclaration(node) ||
            ts.isTypeNode(node) ||
            isConsoleCall(node) ||
            isFailureCodeTable(node)
        ) {
            return;
        }
        if (ts.isJsxAttribute(node) && EXEMPT_JSX_ATTRIBUTE(node.name.getText(source))) return;
        if (ts.isJsxElement(node) && isClosedFold(node)) {
            // The attributes and a `<summary>` stay on screen; the rest is the fold's body.
            visit(node.openingElement);
            node.children.forEach((child) => {
                if (ts.isJsxElement(child) && jsxTag(child) === "summary") visit(child);
            });
            return;
        }
        if (ts.isPropertyAssignment(node)) {
            if (ts.isComputedPropertyName(node.name)) visit(node.name);
            const isCode = ts.isIdentifier(node.name) && node.name.text === "code";
            if (!(isCode && ts.isStringLiteralLike(node.initializer))) visit(node.initializer);
            return;
        }
        if (ts.isBinaryExpression(node) && isEquality(node)) {
            for (const side of [node.left, node.right]) {
                if (!ts.isStringLiteralLike(side)) visit(side);
            }
            return;
        }
        if (ts.isCaseClause(node)) {
            if (!ts.isStringLiteralLike(node.expression)) visit(node.expression);
            node.statements.forEach(visit);
            return;
        }
        // A value read into text is not a literal, so the words above cannot see it.
        if (
            (ts.isTemplateSpan(node) || (ts.isJsxExpression(node) && reachesTheText(node))) &&
            node.expression !== undefined &&
            ts.isPropertyAccessExpression(node.expression) &&
            (RAW_FIELDS.has(node.expression.name.text) ||
                (fileName.endsWith(".tsx") && RAW_ID_FIELDS.has(node.expression.name.text)))
        ) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            found.push({ line: line + 1, text: `raw field: ${node.expression.getText(source)}` });
        }
        if (
            ts.isStringLiteralLike(node) ||
            ts.isJsxText(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            if (node.text.trim() !== "") {
                const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                found.push({ line: line + 1, text: node.text });
            }
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function offences(fileName: string, text: string): readonly string[] {
    return visibleLiterals(fileName, text).flatMap((literal) =>
        FORBIDDEN.filter((pattern) => pattern.test(literal.text)).map(
            (pattern) => `${fileName}:${String(literal.line)} ${pattern.source}: ${literal.text}`,
        ),
    );
}

/** What the scan read. A scan with nothing to read did not happen, so it throws. */
function scan(files: readonly string[]): {
    readonly literals: number;
    readonly offences: readonly string[];
} {
    if (files.length === 0) throw new Error("the product-words scan found no files");
    const texts = files.map((file) => [file, readFileSync(path.join(ROOT, file), "utf8")] as const);
    return {
        literals: texts.flatMap(([file, text]) => visibleLiterals(file, text)).length,
        offences: texts.flatMap(([file, text]) => offences(file, text)),
    };
}

function runtimeSources(): readonly string[] {
    const { runtimeFiles } = checkRenderGraph({ root: ROOT });
    return runtimeFiles.filter((file) => !file.endsWith(".json"));
}

describe("product words", () => {
    it("reads the render's runtime graph and the failure message files", () => {
        const files = runtimeSources();
        expect(files.length).toBeGreaterThanOrEqual(50);
        expect(files).toContain("src/components/chat/AskDevChat.tsx");
        expect(files).toContain("src/components/FailurePanel.tsx");
        expect(files).toContain("src/lib/presentation.ts");
        // Only type edges reach it, so it never loads in a host.
        expect(files).not.toContain("src/lib/enrichment/library.tsx");
        const { literals } = scan([...files, ...FAILURE_MESSAGE_FILES]);
        expect(literals).toBeGreaterThan(1000);
    });

    it("finds no internal name, ticket or raw code in what a user can reach", () => {
        expect(scan([...runtimeSources(), ...FAILURE_MESSAGE_FILES]).offences).toEqual([]);
    });
});

describe("the guard", () => {
    it("fails when it finds no files", () => {
        expect(() => scan([])).toThrow("found no files");
    });

    it.each([
        ["a template", "const a = <p>{`Failure: ${failure.code}`}</p>;"],
        ["a JSX expression", "const a = <p>{failure.upstreamCode}</p>;"],
        ["a title", "const a = <p title={failure.httpStatus} />;"],
        ["the details", "const a = <p>{failure.details}</p>;"],
        ["an id", "const a = <p>{chosen.canonical_id}</p>;"],
        ["a receipt", "const a = <p>{candidate.receipt_id}</p>;"],
        ["an applied value", "const a = <p>{entry.applied_value}</p>;"],
        ["a kind", "const a = <p>{subject.kind}</p>;"],
        ["a state", "const a = <p title={`${name}: ${source.state}`} />;"],
    ])("fires on a raw field read into %s", (_name, source) => {
        expect(offences("plant.tsx", source)).toHaveLength(1);
    });

    it("does not fire on a raw field that only the old rule held", () => {
        const source = "const a = <p>{completeness.terminal_status}</p>;";
        expect(offences("plant.tsx", source)).toEqual([]);
    });

    it.each([
        ["a Details body", '<Details summary="Fold"><code>ACR said so</code></Details>'],
        ["a details body", "<details><summary>Fold</summary><p>ACR said so</p></details>"],
        ["a nested body", '<Details summary="Fold"><div><p>ACR said so</p></div></Details>'],
        ["a raw field in a fold", '<Details summary="Fold"><code>{failure.code}</code></Details>'],
        ["a raw value in a fold", "<details><summary>Fold</summary>{failure.details}</details>"],
    ])("allows %s, by position", (_name, jsx) => {
        expect(offences("plant.tsx", `const a = ${jsx};`)).toEqual([]);
    });

    it.each([
        ["a Details summary", '<Details summary="ACR said so"><code>x</code></Details>'],
        ["a details summary", "<details><summary>ACR said so</summary><p>x</p></details>"],
        ["an open details body", "<details open><p>ACR said so</p></details>"],
        ["a summary's raw field", "<details><summary>{failure.code}</summary><p>x</p></details>"],
    ])("fires on %s: it stays on screen", (_name, jsx) => {
        expect(offences("plant.tsx", `const a = ${jsx};`)).toHaveLength(1);
    });

    it("one word in a fold and one in visible text: only the visible one fires", () => {
        const source = [
            "const a = (",
            "    <div>",
            '        <Details summary="Fold">ACR in the fold</Details>',
            "        <p>ACR on the page</p>",
            "    </div>",
            ");",
        ].join("\n");

        const found = offences("plant.tsx", source);
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("ACR on the page");
    });

    it("does not fire on a raw field read into a data attribute, or into a lookup", () => {
        const source = "const a = <p data-failure-code={failure.code}>{WORDS[failure.code]}</p>;";
        expect(offences("plant.tsx", source)).toEqual([]);
    });

    it.each([
        ["JSX text", "const a = <p>ACR said so</p>;"],
        ["a title", 'const a = <p title="ACR said so" />;'],
        ["an aria-label", 'const a = <p aria-label="ACR said so" />;'],
        ["a placeholder", 'const a = <input placeholder="ACR said so" />;'],
        ["a template head", "const a = (b: string) => `ACR said ${b}`;"],
        ["a template tail", "const a = (b: string) => `${b} ACR said`;"],
        ["a plain string", 'const a = "ACR said so";'],
        ["a table value", 'const a = { reason: "ACR said so" };'],
        ["a call argument", 'label("ACR said so");'],
        ["a code that holds a sentence, in a template", "const a = { code: `${x} ACR said so` };"],
    ])("fires on %s", (_name, source) => {
        expect(offences("plant.tsx", source)).toHaveLength(1);
    });

    it.each([
        ["ACR", "the ACR service"],
        ["Context Fabric", "the Context Fabric engine"],
        ["Workbench", "the Workbench"],
        ["a ticket", "see CHAOS-3813"],
        ["a failure code", "acr_rejected_request"],
        ["an HTTP status", "HTTP 413"],
    ])("fires on %s", (_name, words) => {
        expect(offences("plant.ts", `const a = ${JSON.stringify(words)};`)).toHaveLength(1);
    });

    it.each([
        ["a comment", "// ACR said so\nconst a = 1;"],
        ["a block comment", "/* the Workbench */\nconst a = 1;"],
        ["a JSX comment", "const a = <p>{/* ACR said so */}</p>;"],
        ["a log call", 'console.error("ACR said so");'],
        ["a test id", 'const a = <p data-testid="ACR said so" />;'],
        ["a key", 'const a = <p key="ACR said so" />;'],
        ["a data attribute", 'const a = <p data-reason="acr_rejected_request" />;'],
        ["a class name", 'const a = <p className="ACR" />;'],
        ["an import path", 'import a from "./ACR said so";'],
        ["an export path", 'export { a } from "./ACR said so";'],
        ["a type", 'type A = "acr_timeout" | "acr_unreachable";'],
        ["an object key", 'const a = { "X-ACR-Web-Assertion": 1 };'],
        ["a failure code", 'const a = { code: "acr_timeout" };'],
        ["a comparison", 'const a = failure.code === "acr_timeout";'],
        ["a case label", 'switch (a) { case "acr_timeout": break; }'],
        ["the code table", 'const workbenchFailureCodes = ["acr_timeout"] as const;'],
    ])("exempts %s", (_name, source) => {
        expect(offences("plant.tsx", source)).toEqual([]);
    });

    it("exempts a position only, never what it holds", () => {
        // What a comparison or a case returns still reaches a user.
        expect(offences("plant.ts", 'const a = b === "c" ? "ACR said so" : "d";')).toHaveLength(1);
        expect(offences("plant.ts", 'switch (a) { case "b": return "ACR said so"; }')).toHaveLength(
            1,
        );
        // A call inside a log-free expression is scanned.
        expect(offences("plant.ts", 'console.error("a");\nconst b = "ACR said so";')).toHaveLength(
            1,
        );
    });
});
