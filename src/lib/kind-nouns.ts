import type { StructureSubjectKind } from "@/lib/contracts";

/**
 * Literal kind-noun binding (CHAOS-4343 item 3).
 *
 * Walkthrough finding (2026-08-26, `.remember/context-fabric/cf-fleet-incidents.md`):
 * a question containing the literal word "project" still produced a kind
 * offer — the interpreter didn't bind `expected_kind` from the noun the
 * tester actually typed, so the panel re-asked for something the question
 * already said.
 *
 * The fix is client-side and additive only: `InvestigationRequest.expected_kinds`
 * (CHAOS-3972 P3, `src/contracts/generated/investigation-request.ts`) is the
 * caller's own explicit expected_kind guess(es) — a plain request field, not
 * a receipt, so it needs no prior result to redeem and is safe to send on a
 * FRESH question. No ACR change: the field already exists on the pinned
 * contract and was simply never populated by this client.
 *
 * Only the closed subset of nouns that map to exactly one `StructureSubjectKind`
 * unambiguously is matched — the ticket's own examples ("project",
 * "repository", "team"). This is deliberately NOT exhaustive over
 * `SUBJECT_KIND_VOCABULARY`: a noun like "item" or "run" is far too generic
 * to bind safely, and a wrong guess here would silently misdirect the
 * investigation rather than merely fail to save a re-ask. Extend the list
 * only with nouns that are similarly unambiguous.
 *
 * Word-boundary matched (never a substring of a longer word — "reprojection"
 * must not match "project"), case-insensitive, singular or plural.
 */
const LITERAL_KIND_NOUN_PATTERNS: ReadonlyArray<{
    readonly pattern: RegExp;
    readonly kind: StructureSubjectKind;
}> = [
    { pattern: /\bprojects?\b/iu, kind: "project" },
    { pattern: /\brepositor(?:y|ies)\b/iu, kind: "repository" },
    { pattern: /\bteams?\b/iu, kind: "team" },
];

/**
 * The literal kind nouns present in `question`, deduplicated, in the fixed
 * order `LITERAL_KIND_NOUN_PATTERNS` declares them (never the order the
 * words happen to appear in the question — a stable, closed-vocab order,
 * the same discipline `STRUCTURE_NEED_KINDS_IN_PRIORITY_ORDER` holds).
 * Empty when the question names none of them.
 */
export function literalKindNounsInQuestion(question: string): readonly StructureSubjectKind[] {
    const found: StructureSubjectKind[] = [];
    for (const { pattern, kind } of LITERAL_KIND_NOUN_PATTERNS) {
        if (pattern.test(question)) {
            found.push(kind);
        }
    }
    return found;
}
