import type { InvestigationResult } from "@/lib/contracts";

/**
 * Reference-only value resolution (CHAOS-3738).
 *
 * The spec's hard rule is that **every rendered material value resolves to the
 * canonical result or the manifest** — model-authored factual props are
 * unavailable. The mechanism is this: a material prop in an enrichment
 * composition may never be a literal. It must be a REFERENCE of the form
 *
 *     @result.deterministic_answer
 *     @result.drivers.0.title
 *     @result.coverage.sources.2.state
 *
 * which is resolved against the immutable result at render time. A composition
 * that puts a literal where a material value belongs is rejected before it
 * renders, so there is no path by which prose can be invented, paraphrased, or
 * subtly altered — the renderer can only echo bytes that are already in the
 * result.
 *
 * Non-material props (a layout variant, a section heading drawn from the
 * Dev Health-owned manifest) are a separate, closed vocabulary and never come
 * from here.
 */

export const REF_PREFIX = "@result.";

export type RefResolution =
    | { readonly ok: true; readonly value: string | number | boolean }
    | { readonly ok: false; readonly reason: string };

/** True when a prop value has the shape of a result reference. */
export function isRef(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(REF_PREFIX);
}

/**
 * Splits `@result.drivers.0.title` into `["drivers", "0", "title"]`.
 *
 * Rejects empty segments so `@result..title` or a trailing dot cannot resolve
 * to the parent object by accident.
 */
function segments(ref: string): readonly string[] | undefined {
    const path = ref.slice(REF_PREFIX.length);
    if (path === "") return undefined;
    const parts = path.split(".");
    return parts.some((part) => part === "") ? undefined : parts;
}

/**
 * Resolves a reference against the result.
 *
 * Only SCALARS resolve. An object or array is never renderable material — if a
 * composition points a text prop at `@result.coverage`, that is a defect in the
 * composition, not something to stringify into `[object Object]`. Returning a
 * reason (rather than undefined) lets the validator report which ref failed and
 * why, which is the difference between a debuggable rejection and a mystery.
 */
// `ref` is deliberately `unknown`: it arrives as a parsed prop value, so the
// guard below is a real runtime check, not a formality the type system has
// already settled.
export function resolveRef(result: InvestigationResult, ref: unknown): RefResolution {
    if (!isRef(ref)) return { ok: false, reason: `not a result reference: ${String(ref)}` };
    const parts = segments(ref);
    if (parts === undefined) return { ok: false, reason: `malformed reference: ${ref}` };

    let cursor: unknown = result;
    for (const part of parts) {
        if (cursor === null || cursor === undefined) {
            return { ok: false, reason: `unresolved reference: ${ref}` };
        }
        if (Array.isArray(cursor)) {
            // Index must be a plain non-negative integer. `length`, `constructor`,
            // and friends are properties of the array object, not data, and must
            // not be reachable from a composition.
            if (!/^\d+$/u.test(part)) {
                return { ok: false, reason: `array index expected in ${ref}` };
            }
            cursor = cursor[Number(part)];
            continue;
        }
        if (typeof cursor !== "object") {
            return { ok: false, reason: `unresolved reference: ${ref}` };
        }
        // Own properties only. Without this, `@result.constructor` or
        // `@result.__proto__.x` would walk the prototype chain out of the data
        // and into JavaScript internals.
        if (!Object.hasOwn(cursor, part)) {
            return { ok: false, reason: `unresolved reference: ${ref}` };
        }
        cursor = (cursor as Record<string, unknown>)[part];
    }

    if (cursor === null || cursor === undefined) {
        return { ok: false, reason: `unresolved reference: ${ref}` };
    }
    if (typeof cursor === "string" || typeof cursor === "number" || typeof cursor === "boolean") {
        return { ok: true, value: cursor };
    }
    return { ok: false, reason: `reference does not resolve to a scalar: ${ref}` };
}

/** Resolves a reference to display text, or `undefined` when it does not resolve. */
export function resolveRefText(result: InvestigationResult, ref: string): string | undefined {
    const resolution = resolveRef(result, ref);
    return resolution.ok ? String(resolution.value) : undefined;
}
