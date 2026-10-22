import path from "node:path";

import ts from "typescript";

const ALWAYS = new Set(["attention_rank", "ranking_computed", "ranking_basis"]);
const MEMBER_ONLY = new Set(["score", "drivers"]);
const RANK_FIELDS = new Set([...ALWAYS, ...MEMBER_ONLY]);
const MEMBER_TYPE_NAME = "CohortMember";
const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * AST scan for direct reads of a cohort member's rank, score or driver
 * fields: property access, string-literal element access, and destructuring
 * (binding patterns, including `for (const { score } of members)` and
 * parameters). `score` and `drivers` are flagged only when the receiver or
 * source expression names a member, because a result's own `drivers` array is
 * a different field.
 */
export function findRankReads(source: string): string[] {
    const file = ts.createSourceFile(
        "scan.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const hits: string[] = [];
    const memberish = (text: string): boolean => /member/i.test(text);
    const flag = (name: string, receiver: string, node: ts.Node): void => {
        if (ALWAYS.has(name) || (MEMBER_ONLY.has(name) && memberish(receiver))) {
            hits.push(
                `${name}@${String(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`,
            );
        }
    };
    const patternSource = (pattern: ts.Node): string => {
        const parent = pattern.parent;
        if (ts.isVariableDeclaration(parent)) {
            const loop = parent.parent.parent;
            if (ts.isForOfStatement(loop)) return loop.expression.getText();
            return (parent.initializer?.getText() ?? "") + (parent.type?.getText() ?? "");
        }
        if (ts.isParameter(parent)) {
            const call = parent.parent.parent;
            const callee =
                ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
                    ? call.expression.expression.getText()
                    : "";
            return (parent.type?.getText() ?? "") + callee;
        }
        return "";
    };
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
            flag(node.name.text, node.expression.getText(), node);
        } else if (ts.isElementAccessExpression(node)) {
            const arg = node.argumentExpression;
            if (ts.isStringLiteralLike(arg)) flag(arg.text, node.expression.getText(), node);
        } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
            const key = node.propertyName ?? node.name;
            const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : "";
            flag(name, patternSource(node.parent), node);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return hits;
}

function compilerOptions(): { options: ts.CompilerOptions } {
    const configPath = path.join(ROOT, "tsconfig.json");
    const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
    return {
        options: { ...parsed.options, noEmit: true, incremental: false, skipLibCheck: true },
    };
}

function isMemberType(checker: ts.TypeChecker, type: ts.Type): boolean {
    const t = checker.getNonNullableType(type);
    if (t.aliasSymbol?.getName() === MEMBER_TYPE_NAME) return true;
    if (t.isUnionOrIntersection()) return t.types.some((part) => isMemberType(checker, part));
    return false;
}

function scanFile(checker: ts.TypeChecker, file: ts.SourceFile): string[] {
    const hits: string[] = [];
    const mark = (name: string, node: ts.Node): void => {
        hits.push(
            `${name}@${String(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`,
        );
    };
    const typedMember = (expression: ts.Node): boolean =>
        isMemberType(checker, checker.getTypeAtLocation(expression));
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
            if (RANK_FIELDS.has(node.name.text) && typedMember(node.expression)) {
                mark(node.name.text, node);
            }
        } else if (ts.isElementAccessExpression(node)) {
            const arg = node.argumentExpression;
            if (
                ts.isStringLiteralLike(arg) &&
                RANK_FIELDS.has(arg.text) &&
                typedMember(node.expression)
            ) {
                mark(arg.text, node);
            }
        } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
            const key = node.propertyName ?? node.name;
            const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : "";
            if (RANK_FIELDS.has(name) && typedMember(node.parent)) mark(name, node);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return hits;
}

/**
 * Type-aware scan: a read of a rank field is flagged when the receiver's
 * checked type is the contract's CohortMember (through any alias, destructure,
 * for-of or callback parameter), or when the name heuristic of
 * `findRankReads` flags it (the fallback for `any` and casts).
 */
export function findRankReadsTyped(source: string): string[] {
    const { options } = compilerOptions();
    const virtual = path.join(ROOT, "src/test/__rank_read_scan_virtual__.tsx");
    const host = ts.createCompilerHost(options);
    const baseGet = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) =>
        path.resolve(name) === virtual
            ? ts.createSourceFile(name, source, languageVersion, true, ts.ScriptKind.TSX)
            : baseGet(name, languageVersion, ...rest);
    const program = ts.createProgram([virtual], options, host);
    const file = program.getSourceFile(virtual);
    if (file === undefined) return findRankReads(source);
    const typed = scanFile(program.getTypeChecker(), file);
    return [...new Set([...typed, ...findRankReads(source)])];
}

/**
 * The same scan over real files: one program for every path given, so the
 * checker is built once. Returns the offending relative paths with their hits.
 */
export function findRankReadsInFiles(absolutePaths: readonly string[]): Map<string, string[]> {
    const { options } = compilerOptions();
    const program = ts.createProgram([...absolutePaths], options);
    const checker = program.getTypeChecker();
    const found = new Map<string, string[]>();
    for (const abs of absolutePaths) {
        const file = program.getSourceFile(abs);
        if (file === undefined) throw new Error(`rank-read scan could not load ${abs}`);
        const hits = [...new Set([...scanFile(checker, file), ...findRankReads(file.text)])];
        if (hits.length > 0) found.set(abs, hits);
    }
    return found;
}
