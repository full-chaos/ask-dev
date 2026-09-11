import { useId } from "react";

import { Badge } from "@/components/Badge";
import { Details } from "@/components/Details";
import type { Coverage, CoverageDetail } from "@/lib/contracts";
import { coverageStateTone, humanizeTerm, nonBlank } from "@/lib/presentation";

export type CoveragePanelProps = {
    readonly coverage: Coverage;
};

/** The deterministic fail-readable floor for a source absent a `label` (never a guess at what the raw name means). */
const GENERIC_SOURCE_LABEL = "Source";

/**
 * The deterministic fail-readable floor for a degraded reason with no
 * usable text at all: a fixed, content-independent sentence, never derived
 * from the raw reason text it accompanies (CHAOS-4691's pin delta item 6
 * rules out "reconstruct by parsing" as a path even for old data). Used
 * for a reason with NO usable text at all — `phrasing`, `label` and the raw
 * string every one of them absent or whitespace-only (`label`'s only wire
 * bound is `minLength: 1`, which a lone space satisfies).
 *
 * A legacy `degraded_reasons[]` entry does NOT get this floor: that raw
 * string is itself reason text, so it shows verbatim (see
 * `degradedReasonDisplay`). Displaying a raw string is not the
 * "reconstruct by parsing" CHAOS-4691 forbids — nothing derives a sentence
 * from it. The wording therefore promises no `<details>`, because in the
 * only case this floor fires there is nothing to put in one.
 */
const GENERIC_DEGRADED_REASON_SENTENCE =
    "This source didn't fully contribute; no reason was reported.";

/**
 * What a degraded reason SHOWS, and what is left over as supplementary detail.
 *
 * INVARIANT: whenever the headline is non-complete, the reason itself is
 * VISIBLE BY DEFAULT; a collapsed `<details>` carries only supplementary
 * detail, and only once a reason already shows. A reason whose sole text is
 * the raw string — every legacy `degraded_reasons[]` entry, and a new-shape
 * detail whose `phrasing` and `label` are both whitespace-only — must not put
 * a content-free sentence on screen with the real reason one click away: the
 * visible page would disclose strictly less than the result carries.
 *
 * ONE rule for both reason shapes rather than per-shape branches: show the
 * best REAL text available, and disclose `raw` only when it is not already
 * what is shown. Displaying `raw` verbatim is not the "reconstruct by parsing"
 * CHAOS-4691 forbids — nothing here derives a sentence from it; the generic
 * floor still covers a reason with no usable text at all.
 */
function degradedReasonDisplay(reason: {
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
 * legacy result's raw string is therefore never parsed into a sentence — it
 * is shown VERBATIM instead, on screen rather than behind a closed
 * disclosure, so the visible page discloses what the result carries.
 * Degraded, not silently dropped, and not reconstructed. This legacy
 * rendering is triggered by "no DEGRADING detail covers this" — `details`
 * absent (the true legacy shape) OR merely insufficient (present but empty,
 * or present without a matching degrading entry) both count, so a
 * schema-valid but internally inconsistent response can never silently
 * drop a real `degraded_reasons[]` entry either.
 */
export function CoveragePanel({ coverage }: CoveragePanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns.
    const idPrefix = useId();
    const degradingDetails: readonly CoverageDetail[] =
        coverage.details?.filter((detail) => detail.degrading) ?? [];
    // codex round 3, P2, EXECUTED: gated on `details === undefined` alone,
    // this silently dropped a non-empty `degraded_reasons[]` whenever
    // `details` was PRESENT but had no degrading entries (e.g. `details:
    // []`) — a schema-valid, if internally inconsistent, response. The
    // fallback to the generic-sentence rendering (never a parsed one — see
    // this component's own doc comment above) now triggers whenever the
    // structured details don't already cover any degradation, regardless
    // of whether `details` is absent (the true legacy shape) or merely
    // insufficient — never a silent drop either way.
    const legacyDegradedReasons =
        degradingDetails.length === 0 ? (coverage.degraded_reasons ?? []) : [];
    // CHAOS-4524 / CHAOS-4568: an empty source list is absence of evidence,
    // not completeness. `coverage.partial === false` only means "nothing
    // observed was dropped" — it says nothing about whether anything was
    // read at all, so the headline must check `sources.length` FIRST. A
    // gap presented as "Complete" is the exact failure this panel's doc
    // comment above says it exists to prevent (AGENTS.md check 12: missing
    // is not healthy).
    const hasSources = coverage.sources.length > 0;
    // Same rule for a NON-EMPTY list: `partial === false` says only that
    // nothing OBSERVED was dropped, not that the sources which were read
    // contributed anything. A result can be `partial: false` with its only
    // source `unavailable`; calling that "Complete — every source
    // contributed." is a known gap read as apparent completeness, the one
    // failure this panel exists to prevent, and the same defect as an empty
    // list reading as Complete.
    //
    // Gated through the one swept `coverageStateTone` predicate rather than a
    // second hand list of state names: that switch is exhaustive over the
    // closed contract enum, so a state acr adds must be classified there and
    // this headline follows automatically instead of silently defaulting to
    // "contributed". `ok` is the only tone that means the source actually
    // delivered what was asked of it; `warn` (stale/truncated/conflicted/
    // pruned), `bad` (unavailable/unauthorized) and `neutral` (unconfigured/
    // no_data/not_applicable) each mean it did not, fully or at all.
    const everySourceContributed = coverage.sources.every(
        (source) => coverageStateTone(source.state) === "ok",
    );
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
                    : coverage.partial || !everySourceContributed
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
                            const name = nonBlank(source.label) ?? GENERIC_SOURCE_LABEL;
                            const stateText =
                                nonBlank(source.state_label) ?? humanizeTerm(source.state);
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
                                const name = nonBlank(source.label) ?? GENERIC_SOURCE_LABEL;
                                const stateText =
                                    nonBlank(source.state_label) ?? humanizeTerm(source.state);
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
                        {degradingDetails.map((detail) => {
                            // CHAOS-4690: synthesis-phrased sentence when the
                            // model chose to phrase it, else the deterministic
                            // Label floor; then the raw text, and only then the
                            // content-free floor — one rule, shared with the
                            // legacy block below (see `degradedReasonDisplay`).
                            const shown = degradedReasonDisplay(detail);
                            return (
                                <li className="record" key={detail.detail_id}>
                                    <p className="record__body">{shown.text}</p>
                                    {shown.supplementaryRaw === undefined ? null : (
                                        <Details
                                            data-testid="degraded-reason-raw"
                                            summary="Raw reason"
                                        >
                                            <code>{shown.supplementaryRaw}</code>
                                        </Details>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
            {legacyDegradedReasons.length === 0 ? null : (
                <>
                    <h3 className="panel__title" style={{ marginTop: 14 }}>
                        Degraded reasons
                    </h3>
                    <ul className="stack stack--tight">
                        {legacyDegradedReasons.map((reason) => {
                            // The legacy `degraded_reasons[]` string IS the only
                            // reason text there is, so it is what shows; there is
                            // nothing left to put behind a disclosure.
                            const shown = degradedReasonDisplay({ raw: reason });
                            return (
                                <li className="record" key={reason}>
                                    {/* `<code>` only when what shows IS the raw
                                        wire text; the generic floor is prose. */}
                                    <p className="record__body">
                                        {shown.text === nonBlank(reason) ? (
                                            <code>{shown.text}</code>
                                        ) : (
                                            shown.text
                                        )}
                                    </p>
                                    {shown.supplementaryRaw === undefined ? null : (
                                        <Details
                                            data-testid="degraded-reason-raw"
                                            summary="Raw reason"
                                        >
                                            <code>{shown.supplementaryRaw}</code>
                                        </Details>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
