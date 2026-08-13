"use client";

import { Renderer } from "@openuidev/react-lang";
import { useMemo, useState } from "react";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import type { InvestigationResult } from "@/lib/contracts";
import { EnrichmentResultProvider } from "@/lib/enrichment/context";
import { enrichmentLibrary } from "@/lib/enrichment/library";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import { validateEnrichment, type EnrichmentViolation } from "@/lib/enrichment/validate";

export type EnrichmentViewProps = {
    readonly result: InvestigationResult;
    /** The presentation composition. Model-authored later; supplied by a caller today. */
    readonly composition: string;
};

/**
 * The OpenUI enrichment view (CHAOS-3738).
 *
 * Fails closed, in two independent stages:
 *
 *  1. **Before rendering.** The whole composition is validated against the
 *     manifest and this result. Any violation and nothing is mounted — the
 *     deterministic view renders instead, with the reason shown. This is the
 *     stage that matters, because OpenUI's renderer is progressive by design:
 *     given a bad composition it drops the offending node and renders the rest,
 *     which is precisely the partial render the spec forbids.
 *
 *  2. **During rendering.** A validated composition can still throw — a
 *     reference resolving differently than validation saw, a component bug. The
 *     renderer's `onError` switches the view to deterministic rather than
 *     leaving a half-drawn answer on screen.
 *
 * `toolProvider` is `null` so `Query()` and `Mutation()` cannot execute even if
 * validation somehow admitted one, and no component in the library declares an
 * action, so `@OpenUrl` and `@ToAssistant` have nothing to attach to.
 *
 * **The answer never changes when this falls back.** Both views render the same
 * immutable result; only the presentation differs.
 */
export function EnrichmentView({ result, composition }: EnrichmentViewProps) {
    const validation = useMemo(
        () => validateEnrichment(composition, result, PRESENTATION_MANIFEST_V1),
        [composition, result],
    );
    const [runtimeFailure, setRuntimeFailure] = useState<string | undefined>(undefined);

    const violations: readonly EnrichmentViolation[] = validation.ok ? [] : validation.violations;
    const fellBack = !validation.ok || runtimeFailure !== undefined;

    if (fellBack) {
        return (
            <div>
                <section className="panel panel--failure" aria-label="Enrichment fell back">
                    <h2 className="panel__title">Enriched view unavailable</h2>
                    <p className="answer__body">
                        The enriched presentation failed validation, so the deterministic answer is
                        shown instead. The answer itself is unchanged.
                    </p>
                    <ul className="stack stack--tight">
                        {runtimeFailure === undefined ? null : (
                            <li className="record">
                                <code>render: {runtimeFailure}</code>
                            </li>
                        )}
                        {violations.map((violation) => (
                            <li
                                className="record"
                                key={`${violation.predicate}:${violation.detail}`}
                            >
                                <code>
                                    {violation.predicate}: {violation.detail}
                                </code>
                            </li>
                        ))}
                    </ul>
                </section>
                <DeterministicAnswerView result={result} />
            </div>
        );
    }

    return (
        <EnrichmentResultProvider result={result}>
            <Renderer
                response={composition}
                library={enrichmentLibrary}
                toolProvider={null}
                onError={(errors) => {
                    // OpenUI calls onError with an EMPTY array on a clean
                    // render, not only when something failed. Treating any call
                    // as a failure made the enriched view fall back every time,
                    // permanently — a fail-closed path firing on success is
                    // still a bug, and a quiet one, because falling back always
                    // *looks* like the safe outcome.
                    if (errors.length === 0) return;
                    setRuntimeFailure(
                        errors.map((error) => `${error.code}: ${error.message}`).join("; "),
                    );
                }}
            />
        </EnrichmentResultProvider>
    );
}
