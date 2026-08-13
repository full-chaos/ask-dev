import { createParser } from "@openuidev/react-lang";

import type { InvestigationResult } from "@/lib/contracts";
import { enrichmentLibrary } from "@/lib/enrichment/library";
import { manifestComponent, type PresentationManifest } from "@/lib/enrichment/manifest";
import { isRef, resolveRef } from "@/lib/enrichment/refs";

/**
 * Fail-closed validation of a whole enrichment composition (CHAOS-3738).
 *
 * The spec requires the ENTIRE composition to validate BEFORE rendering, and to
 * fall closed to the deterministic view on any failure. OpenUI's `<Renderer>`
 * does not do that on its own: by design it renders progressively and drops
 * only the offending node, so a bad composition would partially render. The
 * parser, however, can be run on its own — `createParser(...).parse(text)`
 * returns a full `ParseResult` without mounting anything.
 *
 * So the adapter parses first, applies every predicate below, and only then
 * mounts the renderer. Nothing reaches the screen until all of it passes.
 *
 * Two predicates exist because of empirically observed OpenUI behaviour, not
 * because the documentation suggested them:
 *
 *   - `meta.unresolved` is populated while `meta.errors` stays EMPTY for a
 *     dangling reference. A validator checking only `errors` passes a
 *     composition with references to nothing.
 *   - Built-in functions (`@Count(...)`) and `$state` variables raise NO error;
 *     they appear as nodes flagged `hasDynamicProps`. That flag is the tell for
 *     a model-computed value, which the spec forbids outright.
 */

export const enrichmentPredicates = [
    "parse_errors",
    "unresolved_references",
    "incomplete_composition",
    "query_statements",
    "mutation_statements",
    "dynamic_props",
    "state_declarations",
    "root_component",
    "material_prop_not_a_reference",
    "unresolvable_reference",
    "unknown_enum_value",
    "missing_mandatory_section",
] as const;

export type EnrichmentPredicate = (typeof enrichmentPredicates)[number];

export type EnrichmentViolation = {
    readonly predicate: EnrichmentPredicate;
    readonly detail: string;
};

export type EnrichmentValidation =
    | { readonly ok: true; readonly composition: string }
    | { readonly ok: false; readonly violations: readonly EnrichmentViolation[] };

type ParsedNode = {
    readonly type?: string;
    readonly typeName?: string;
    readonly props?: Record<string, unknown>;
    readonly hasDynamicProps?: boolean;
};

function isNode(value: unknown): value is ParsedNode {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === "element"
    );
}

/** Depth-first walk over every element node in a parsed composition. */
function walk(node: unknown, visit: (node: ParsedNode) => void): void {
    if (Array.isArray(node)) {
        for (const item of node) walk(item, visit);
        return;
    }
    if (!isNode(node)) return;
    visit(node);
    for (const value of Object.values(node.props ?? {})) walk(value, visit);
}

/**
 * Validates a composition against the manifest and the immutable result.
 *
 * Returns every violation rather than the first, so a failure is diagnosable in
 * one pass instead of one recompile at a time.
 */
export function validateEnrichment(
    composition: string,
    result: InvestigationResult,
    manifest: PresentationManifest,
): EnrichmentValidation {
    const violations: EnrichmentViolation[] = [];
    const add = (predicate: EnrichmentPredicate, detail: string) =>
        violations.push({ predicate, detail });

    const parser = createParser(enrichmentLibrary.toJSONSchema());
    const parsed = parser.parse(composition);

    // 1. Parser-level validation: unknown component, missing required prop,
    //    null required, inline-reserved, excess args. `excess-args` is only a
    //    warning to OpenUI (it drops the extras and renders anyway); here it is
    //    fatal like the rest, because "silently dropped some of what the model
    //    asked for" is not a state worth rendering.
    for (const error of parsed.meta.errors) {
        add("parse_errors", `${error.code}: ${error.message}`);
    }

    // 2. Dangling references. NOT covered by meta.errors — verified empirically.
    for (const unresolved of parsed.meta.unresolved) {
        add("unresolved_references", `reference to an undefined statement: ${unresolved}`);
    }

    // 3. Truncated or still-streaming output is not a complete composition.
    if (parsed.meta.incomplete) {
        add("incomplete_composition", "the composition is incomplete");
    }

    // 4/5. Query() and Mutation() are unavailable. They parse without error, so
    //      they are rejected here; the renderer is additionally given no
    //      toolProvider, which makes execution impossible even if this missed.
    for (const query of parsed.queryStatements ?? []) {
        add("query_statements", `Query() is unavailable: ${query.statementId ?? "unknown"}`);
    }
    for (const mutation of parsed.mutationStatements ?? []) {
        add(
            "mutation_statements",
            `Mutation() is unavailable: ${mutation.statementId ?? "unknown"}`,
        );
    }

    // 7. Reactive state is a computed value by another name.
    for (const name of Object.keys(parsed.stateDeclarations ?? {})) {
        add("state_declarations", `reactive state is unavailable: ${name}`);
    }

    // 8. Root must be the manifest's root component.
    const root = parsed.root as ParsedNode | null;
    if (root === null || root === undefined) {
        add("root_component", "the composition has no root element");
    } else if (root.typeName !== manifest.root) {
        add("root_component", `root must be ${manifest.root}, got ${String(root.typeName)}`);
    }

    walk(root, (node) => {
        const name = node.typeName ?? "";

        // 6. Built-in functions and computed expressions.
        if (node.hasDynamicProps === true) {
            add(
                "dynamic_props",
                `${name} carries a computed prop; model-authored values are not permitted`,
            );
        }

        const declared = manifestComponent(manifest, name);
        if (declared === undefined) {
            // The closed library already rejects unknown components at parse
            // time; this catches a component that is in the library but was
            // removed from the manifest, so the two cannot silently diverge.
            add("parse_errors", `${name} is not declared in the manifest`);
            return;
        }

        for (const [prop, value] of Object.entries(node.props ?? {})) {
            if (declared.childProps?.includes(prop) === true) continue;

            const allowed = declared.enumProps?.[prop];
            if (allowed !== undefined) {
                // 11. Closed vocabulary props.
                if (typeof value !== "string" || !allowed.includes(value)) {
                    add(
                        "unknown_enum_value",
                        `${name}.${prop} must be one of ${allowed.join(", ")}`,
                    );
                }
                continue;
            }

            if (!declared.materialProps.includes(prop)) continue;

            // 9. A material prop must be a reference, never a literal. This is
            //    the rule that makes model-authored prose impossible rather
            //    than merely discouraged.
            if (!isRef(value)) {
                add(
                    "material_prop_not_a_reference",
                    `${name}.${prop} must be a @result. reference, not a literal`,
                );
                continue;
            }

            // 10. And it must actually resolve against THIS result.
            const resolution = resolveRef(result, value);
            if (!resolution.ok) {
                add("unresolvable_reference", `${name}.${prop}: ${resolution.reason}`);
            }
        }
    });

    // 12. Mandatory sections. Omitting coverage or limitations would let an
    //     enriched view read as more confident than the result supports, which
    //     is the exact failure the spec's "fails closed" rule exists to stop.
    const present = new Set<string>();
    walk(root, (node) => {
        if (node.typeName !== undefined) present.add(node.typeName);
    });
    for (const section of manifest.mandatorySections) {
        if (!present.has(section)) {
            add("missing_mandatory_section", `the composition omits the ${section} section`);
        }
    }

    return violations.length === 0 ? { ok: true, composition } : { ok: false, violations };
}
