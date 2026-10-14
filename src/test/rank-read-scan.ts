import ts from "typescript";

const ALWAYS = new Set(["attention_rank", "ranking_computed", "ranking_basis"]);
const MEMBER_ONLY = new Set(["score", "drivers"]);

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
