import type { Coverage, CoverageDetail } from "@/lib/contracts";
import { nonBlank } from "@/lib/presentation";

/**
 * The deterministic fail-readable floor for a degraded reason with no usable
 * text at all: `phrasing`, `label` and the raw string every one of them absent
 * or whitespace-only (`label`'s only wire bound is `minLength: 1`, which a lone
 * space satisfies). A fixed, content-independent sentence, never derived from
 * the reason it stands in for.
 */
export const GENERIC_DEGRADED_REASON_SENTENCE =
    "This source didn't fully contribute; no reason was reported.";

/**
 * What a degraded reason SHOWS, and what is left over as supplementary detail.
 *
 * INVARIANT: whenever the coverage headline is non-complete, the reason itself
 * is VISIBLE BY DEFAULT; a collapsed `<details>` carries only supplementary
 * detail, and only once a reason already shows. A reason whose sole text is the
 * raw string must not put a content-free sentence on screen with the real
 * reason one click away — the visible page would disclose less than the result
 * carries.
 *
 * ONE rule for both reason shapes rather than per-shape branches: show the best
 * REAL text available, and disclose `raw` only when it is not already what
 * shows. Displaying `raw` verbatim is not the consumer-side "reconstruct a
 * sentence by parsing" this repo forbids — nothing here derives a sentence from
 * it.
 */
export function degradedReasonDisplay(reason: {
    readonly phrasing?: string;
    readonly label?: string;
    readonly raw?: string;
}): { readonly text: string; readonly supplementaryRaw: string | undefined } {
    const shown = nonBlank(reason.phrasing) ?? nonBlank(reason.label) ?? nonBlank(reason.raw);
    const raw = nonBlank(reason.raw);
    return {
        text: shown ?? GENERIC_DEGRADED_REASON_SENTENCE,
        supplementaryRaw: raw !== undefined && raw !== shown ? raw : undefined,
    };
}

/** The degrading entries of `coverage.details[]`; a non-degrading entry reports no gap. */
export function degradingDetails(coverage: Coverage | undefined): readonly CoverageDetail[] {
    return coverage?.details?.filter((detail) => detail.degrading) ?? [];
}

/**
 * INVARIANT: reasons are the UNION of the two shapes acr can report them in. A
 * legacy `coverage.degraded_reasons[]` string is withheld only when it is
 * BYTE-IDENTICAL to a degrading detail's rendered line, or to that detail's own
 * `raw` — the contract's verbatim copy of the same reason, already on the page
 * inside that detail's collapsed disclosure. Duplication is tolerated; loss is
 * not, and neither case loses anything.
 *
 * Exact string equality on a contract field, and nothing else. Any PROXY for
 * coverage withholds reasons it never accounted for — a count, or the mere
 * presence of some detail, would hide three raw reasons about one source behind
 * three details about another — and inferring the link from what a string SAYS
 * would mean parsing it, which this module must never do.
 */
export function uncoveredLegacyReasons(coverage: Coverage | undefined): readonly string[] {
    const alreadyCarried = new Set<string>();
    for (const detail of degradingDetails(coverage)) {
        alreadyCarried.add(degradedReasonDisplay(detail).text);
        if (detail.raw !== undefined) alreadyCarried.add(detail.raw);
    }
    return (coverage?.degraded_reasons ?? []).filter((reason) => !alreadyCarried.has(reason));
}

/** How many distinct degraded reasons the response reported, over both shapes. */
export function degradedReasonCount(coverage: Coverage | undefined): number {
    return degradingDetails(coverage).length + uncoveredLegacyReasons(coverage).length;
}
