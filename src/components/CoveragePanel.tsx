import { useId } from "react";

import { Badge } from "@/components/Badge";
import { Details } from "@/components/Details";
import type { Coverage } from "@/lib/contracts";
import { coverageStateTone, humanizeTerm } from "@/lib/presentation";
import {
    humanizeCoverageSourceName,
    humanizeDegradedReason,
    humanizeReasonBody,
} from "@/lib/vocab-mapping";

export type CoveragePanelProps = {
    readonly coverage: Coverage;
};

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
 */
export function CoveragePanel({ coverage }: CoveragePanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns.
    const idPrefix = useId();
    const degradedReasons = coverage.degraded_reasons ?? [];
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
                            // CHAOS-4673: the chip is the always-visible
                            // surface, so it carries the MAPPED name, never
                            // the raw `canonical_fact:*`/`dev-health-ops:*`
                            // identifier — that stays in "Source details"
                            // below, inside the closed disclosure.
                            const name = humanizeCoverageSourceName(source.source);
                            return (
                                <Badge
                                    key={`${source.source}:${source.state}`}
                                    tone={coverageStateTone(source.state)}
                                    title={`${name.sentence}: ${source.state}`}
                                >
                                    {name.sentence} · {humanizeTerm(source.state)}
                                </Badge>
                            );
                        })}
                    </div>
                    <details className="disclosure">
                        <summary>Source details</summary>
                        <div className="coverage">
                            {coverage.sources.map((source) => {
                                const name = humanizeCoverageSourceName(source.source);
                                const reason =
                                    source.reason === undefined
                                        ? undefined
                                        : humanizeReasonBody(source.reason);
                                return (
                                    <div
                                        className="coverage__source"
                                        key={`${source.source}:${source.state}`}
                                    >
                                        <span className="coverage__name">{name.sentence}</span>
                                        <Badge
                                            tone={coverageStateTone(source.state)}
                                            title={source.state}
                                        >
                                            {humanizeTerm(source.state)}
                                        </Badge>
                                        {reason !== undefined ? (
                                            <p className="coverage__reason">{reason.sentence}</p>
                                        ) : null}
                                        {source.observed_at !== undefined ? (
                                            <p className="coverage__reason">
                                                observed at {source.observed_at}
                                            </p>
                                        ) : null}
                                        {/* Raw identifiers stay INSIDE this already-
                                            collapsed "Source details" <details> (CHAOS-4673
                                            acceptance: raw closed-vocabulary strings never
                                            appear outside collapsed Details). */}
                                        <p className="record__meta">
                                            <code>{name.raw}</code>
                                            {reason === undefined ? null : (
                                                <>
                                                    {" · "}
                                                    <code>{reason.raw}</code>
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
            {degradedReasons.length > 0 ? (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Degraded reasons
                    </h3>
                    <ul className="stack stack--tight">
                        {degradedReasons.map((reason) => {
                            // CHAOS-4673: "every degraded reason reads as a
                            // plain sentence" (acceptance) — the raw
                            // `<kind>: unexpanded:<outcome>: ...` string
                            // moves behind ▸Details, never on the lead
                            // surface.
                            const mapped = humanizeDegradedReason(reason);
                            return (
                                <li className="record" key={reason}>
                                    <p className="record__body">{mapped.sentence}</p>
                                    <Details data-testid="degraded-reason-raw" summary="Raw reason">
                                        <code>{mapped.raw}</code>
                                    </Details>
                                </li>
                            );
                        })}
                    </ul>
                </>
            ) : null}
        </section>
    );
}
