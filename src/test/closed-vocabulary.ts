/**
 * Test support: a CLOSED view of a pinned schema.
 *
 * The pinned acr schemas declare many vocabularies as open
 * (`x-documented-values` plus "a client must tolerate values it does not
 * know") where earlier pins declared them as a closed `enum`. Tests that
 * prove a vocabulary member exists, or that reproduce the prior pin's own
 * closed validator, need the member list as an `enum`. This returns a deep
 * clone with every `x-documented-values` array turned into an `enum`. It is a
 * test lens only: the product validator (`validateContract`) never uses it.
 */
export function closedVocabularyView<T>(schema: T): T {
    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(walk);
        if (node === null || typeof node !== "object") return node;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === "x-documented-values") out["enum"] = value;
            else out[key] = walk(value);
        }
        return out;
    };
    return walk(schema) as T;
}
