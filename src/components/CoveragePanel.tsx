import { useId } from "react";

import { Badge } from "@/components/Badge";
import { Details } from "@/components/Details";
import type { Coverage, CoverageDetail } from "@/lib/contracts";
import { coverageStateTone, humanizeTerm } from "@/lib/presentation";

export type CoveragePanelProps = {
    readonly coverage: Coverage;
};

/** The deterministic fail-readable floor for a source absent a `label` (never a guess at what the raw name means). */
const GENERIC_SOURCE_LABEL = "Source";

/**
 * The deterministic fail-readable floor for the LEGACY exception below: a
 * fixed, content-independent sentence, never derived from the raw reason
 * text it accompanies (CHAOS-4691's pin delta item 6 rules out
 * "reconstruct by parsing" as a path even for old data).
 */
const GENERIC_LEGACY_DEGRADED_REASON_SENTENCE =
    "This source didn't fully contribute; see details for the reason.";

/**
 * Shows what the investigation could and could not read.
 *
 * Every source is listed with its contract state term, including the ones
 * that carry no data — `pruned`, `unauthorized`, `no_data`. Hiding them would
 * turn a known gap into apparent completeness, which is the one thing this
 * panel exists to prevent — so CHAOS-4581's compact "strip" treatment below
 * only changes how much is visible BY DEFAULT, never what is reachable: a
 * one-line summary plus a tone-coded chip per source is always on screen,
 * and the full per-source reason/observed-at breakdown is one click away in
 * a `<details>`, not removed.
 *
 * CHAOS-4690/CHAOS-4691: the source name/state chip text and the "Degraded
 * reasons" sentences are no longer derived here — this panel used to run a
 * consumer-side sentence-table parser (`vocab-mapping.ts`'s
 * `humanizeCoverageSourceName`/`humanizeDegradedReason`/`humanizeReasonBody`)
 * over acr's raw closed-vocabulary strings. That module is deleted (chris's
 * strike-three ruling: consumer phrasing tables cease to exist). The chip
 * text now renders the engine's own contract-carried `source.label`/
 * `.state_label` (a totality-tested display-label registry, not a
 * consumer-side guess); the degraded-reason sentences render the engine's
 * own `coverage.details[]` — synthesis-phrased (`.phrasing`) when the model
 * chose to phrase it, the deterministic `.label` floor otherwise (never
 * both blank — `.label` is contract-required on every detail).
 *
 * NAMED EXCEPTION (pin delta item 6, chris-ruled): an immutable result
 * stored before CHAOS-4690 carries `coverage.sources[]`/`degraded_reasons[]`
 * but NONE of the new fields — `coverage.details` is simply absent, not an
 * empty array. Rendering it via the SAME sentence-table parser this ticket
 * deletes would be exactly the banned "reconstruct by parsing" shape, so a
 * legacy result instead gets a fixed, content-independent generic sentence
 * per degraded reason (never derived from what the raw reason text says)
 * with the raw string still one click away in Details — degraded, not
 * silently dropped or leaked.
 */
export function CoveragePanel({ coverage }: CoveragePanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns.
    const idPrefix = useId();
    // `details` being absent (not merely empty) is the legacy-shape
    // discriminator — see this component's own doc comment above.
    const isLegacyShape = coverage.details === undefined;
    const degradingDetails: readonly CoverageDetail[] = isLegacyShape
        ? []
        : coverage.details!.filter((detail) => detail.degrading);
    const legacyDegradedReasons = isLegacyShape ? (coverage.degraded_reasons ?? []) : [];
    // CHAOS-4524 / CHAOS-4568: an empty source list is absence of evidence,
    // not completeness. `coverage.partial === false` only means "nothing
    // observed was dropped" — it says nothing about whether anything was
    // read at all, so the headline must check `sources.length` FIRST. A
    // gap presented as "Complete" is the exact failure this panel's doc
    // comment above says it exists to prevent (AGENTS.md check 12: missing
    // is not healthy).
    const hasSources = coverage.sources.length > 0;
    return (
        <section
            className="panel panel--card panel--compact"
            aria-labelledby={`${idPrefix}-coverage-title`}
            data-testid="coverage-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-coverage-title`}>
                Coverage
            </h2>
            <p className={hasSources ? "record__meta" : "panel__empty"}>
                {!hasSources
                    ? "No sources were recorded."
                    : coverage.partial
                      ? "Partial — some sources did not contribute."
                      : "Complete — every source contributed."}
            </p>
            {!hasSources ? null : (
                <>
                    <div className="chip-row" data-testid="coverage-chip-row">
                        {
                            // codex review round 1 (CHAOS-4581): a color-only
                            // (tone) distinction between e.g. `available` and
                            // `unauthorized`/`no_data` is exactly the "known
                            // gap reads as apparent completeness" failure this
                            // panel exists to prevent (see the doc comment
                            // above) — doubly so behind a title-only tooltip.
                            // The state is real, visible TEXT on every chip,
                            // not just a color or a hover.
                        }
                        {coverage.sources.map((source) => {
                            // CHAOS-4673/CHAOS-4690: the chip is the
                            // always-visible surface, so it carries the
                            // engine's own display label, never the raw
                            // `canonical_fact:*`/`dev-health-ops:*`
                            // identifier — that stays in "Source details"
                            // below, inside the closed disclosure.
                            const name = source.label ?? GENERIC_SOURCE_LABEL;
                            const stateText = source.state_label ?? humanizeTerm(source.state);
                            return (
                                <Badge
                                    key={`${source.source}:${source.state}`}
                                    tone={coverageStateTone(source.state)}
                                    title={`${name}: ${source.state}`}
                                >
                                    {name} · {stateText}
                                </Badge>
                            );
                        })}
                    </div>
                    <details className="disclosure">
                        <summary>Source details</summary>
                        <div className="coverage">
                            {coverage.sources.map((source) => {
                                const name = source.label ?? GENERIC_SOURCE_LABEL;
                                const stateText = source.state_label ?? humanizeTerm(source.state);
                                return (
                                    <div
                                        className="coverage__source"
                                        key={`${source.source}:${source.state}`}
                                    >
                                        <span className="coverage__name">{name}</span>
                                        <Badge
                                            tone={coverageStateTone(source.state)}
                                            title={source.state}
                                        >
                                            {stateText}
                                        </Badge>
                                        {source.observed_at !== undefined ? (
                                            <p className="coverage__reason">
                                                observed at {source.observed_at}
                                            </p>
                                        ) : null}
                                        {/* Raw identifiers stay INSIDE this already-
                                            collapsed "Source details" <details> (CHAOS-4673
                                            acceptance: raw closed-vocabulary strings never
                                            appear outside collapsed Details). The raw
                                            `reason` string is shown verbatim, never parsed
                                            into a sentence here (CHAOS-4690/4691: that job
                                            belongs to "Degraded reasons" below, sourced from
                                            the engine's own `coverage.details[]`). */}
                                        <p className="record__meta">
                                            <code>{source.source}</code>
                                            {source.reason === undefined ? null : (
                                                <>
                                                    {" · "}
                                                    <code>{source.reason}</code>
                                                </>
                                            )}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </details>
                </>
            )}
            {degradingDetails.length === 0 ? null : (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Degraded reasons
                    </h3>
                    <ul className="stack stack--tight">
                        {degradingDetails.map((detail) => (
                            <li className="record" key={detail.detail_id}>
                                {/* CHAOS-4690: synthesis-phrased sentence when
                                    the model chose to phrase it, else the
                                    deterministic Label floor — never both
                                    blank (`label` is contract-required). */}
                                <p className="record__body">{detail.phrasing ?? detail.label}</p>
                                {detail.raw === undefined ? null : (
                                    <Details data-testid="degraded-reason-raw" summary="Raw reason">
                                        <code>{detail.raw}</code>
                                    </Details>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {legacyDegradedReasons.length === 0 ? null : (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Degraded reasons
                    </h3>
                    <ul className="stack stack--tight">
                        {legacyDegradedReasons.map((reason) => (
                            <li className="record" key={reason}>
                                <p className="record__body">
                                    {GENERIC_LEGACY_DEGRADED_REASON_SENTENCE}
                                </p>
                                <Details data-testid="degraded-reason-raw" summary="Raw reason">
                                    <code>{reason}</code>
                                </Details>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
