import type { Coverage, CoverageDetail } from "./contracts";
import { nonBlank } from "./presentation";

/**
 * The deterministic fail-readable floor for a degraded reason with no usable
 * text at all: `phrasing` and `label` both absent or whitespace-only (`label`'s
 * only wire bound is `minLength: 1`, which a lone space satisfies). A fixed,
 * content-independent sentence, never derived from the reason it stands in for.
 */
export const GENERIC_DEGRADED_REASON_SENTENCE =
    "This source didn't fully contribute; no reason was reported.";

/**
 * The plain sentence over a raw reason no sentence was served for: the fold below it holds the
 * reason, so this one must not say that none was reported.
 */
export const RAW_ONLY_DEGRADED_REASON_SENTENCE = "This source did not fully contribute.";

/**
 * What a degraded reason SHOWS, and what is left over as supplementary detail.
 *
 * INVARIANT: visible text is served text. A raw string is a machine token (a
 * real one reads `no_member_found:incident`), so it is never the visible line:
 * it sits in the collapsed fold, under the served sentence, or under the plain
 * floor when none was served. Chris's ruling (CHAOS-12406) on the legacy shape.
 * No reason is dropped.
 *
 * ONE rule for both reason shapes rather than per-shape branches: show the best
 * SERVED text available, and disclose `raw` only when it is not already what
 * shows. Disclosing `raw` verbatim is not the consumer-side "reconstruct a
 * sentence by parsing" this repo forbids — nothing here derives a sentence from
 * it.
 */
export function degradedReasonDisplay(reason: {
    readonly phrasing?: string;
    readonly label?: string;
    readonly raw?: string;
}): { readonly text: string; readonly supplementaryRaw: string | undefined } {
    const shown = nonBlank(reason.phrasing) ?? nonBlank(reason.label);
    const raw = nonBlank(reason.raw);
    return {
        text:
            shown ??
            (raw === undefined
                ? GENERIC_DEGRADED_REASON_SENTENCE
                : RAW_ONLY_DEGRADED_REASON_SENTENCE),
        supplementaryRaw: raw !== undefined && raw !== shown ? raw : undefined,
    };
}

/** The degrading entries of `coverage.details[]`; a non-degrading entry reports no gap. */
export function degradingDetails(coverage: Coverage | undefined): readonly CoverageDetail[] {
    return coverage?.details?.filter((detail) => detail.degrading) ?? [];
}

/**
 * What the answer rests on, though it costs nothing: a non-degrading detail that counts something
 * in it, such as the pull requests that stand on a lower-tier project link. AGENTS.md's entity tree
 * requires a consumer to name that tier, and these details are its only carrier.
 *
 * Chosen by the contract's own fields, never by a list of codes (chris, CHAOS-4690): a counted
 * disclosure ACR adds later shows with no change here. An uncounted one, such as facts that do not
 * apply to what was asked, says nothing of this answer.
 */
export function disclosedDetails(coverage: Coverage | undefined): readonly CoverageDetail[] {
    return (
        coverage?.details?.filter(
            (detail) => !detail.degrading && detail.count !== undefined && detail.count > 0,
        ) ?? []
    );
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
