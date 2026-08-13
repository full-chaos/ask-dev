"use client";

import { createContext, useContext } from "react";

import type { InvestigationResult } from "@/lib/contracts";
import { resolveRef } from "@/lib/enrichment/refs";

/**
 * Supplies the immutable result to the enrichment components.
 *
 * The components receive REFERENCES as props, never values. They resolve them
 * here, against the one result the view was validated against — so there is no
 * path by which a component could render a value that did not come from it.
 */
const ResultContext = createContext<InvestigationResult | null>(null);

export function EnrichmentResultProvider({
    result,
    children,
}: {
    readonly result: InvestigationResult;
    readonly children: React.ReactNode;
}) {
    return <ResultContext.Provider value={result}>{children}</ResultContext.Provider>;
}

/**
 * Resolves a reference prop to display text.
 *
 * Throws when a reference does not resolve. Validation already proved every
 * reference in the composition resolves against this result, so reaching this
 * throw means the validated composition and the rendered one have diverged —
 * a broken invariant, not a data condition. The renderer's error boundary
 * catches it and the view falls closed, which is far better than rendering the
 * word "undefined" where an answer belongs.
 */
export function useResolvedRef(ref: unknown): string {
    const result = useContext(ResultContext);
    if (result === null) {
        throw new Error("enrichment components must render inside EnrichmentResultProvider");
    }
    const resolution = resolveRef(result, ref);
    if (!resolution.ok) throw new Error(resolution.reason);
    return String(resolution.value);
}
