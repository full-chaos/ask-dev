"use client";

import { Renderer } from "@openuidev/react-lang";
import { useMemo, useState } from "react";

import type { ClarificationChoice } from "@/components/ClarificationPanel";
import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import type { InvestigationResult, SubjectRef } from "@/lib/contracts";
import { EnrichmentResultProvider } from "@/lib/enrichment/context";
import { enrichmentLibrary } from "@/lib/enrichment/library";
import { PRESENTATION_MANIFEST_V1 } from "@/lib/enrichment/manifest";
import { validateEnrichment, type EnrichmentViolation } from "@/lib/enrichment/validate";

/**
 * A runtime failure belongs to ONE result and composition, never to the
 * component.
 *
 * Exported and pure so the invariant is testable directly. It has to be: the
 * validator rejects every composition that could make a renderer throw, so
 * there is no reachable trigger for the runtime path today, and a test that
 * drove it through the component would only be exercising the VALIDATION
 * fallback while appearing to cover this. (That is exactly what an earlier
 * version of the test did — mutation testing caught it.)
 */
export function renderFailureFor(
    recorded: { readonly key: string; readonly message: string } | undefined,
    renderKey: string,
): string | undefined {
    return recorded?.key === renderKey ? recorded.message : undefined;
}

export type EnrichmentViewProps = {
    readonly result: InvestigationResult;
    /** The presentation composition. Model-authored later; supplied by a caller today. */
    readonly composition: string;
    /** CHAOS-4343: forwarded verbatim to `DeterministicAnswerView`'s own props of the same names. */
    readonly selectedCandidateReceiptIds?: ReadonlySet<string> | undefined;
    readonly onToggleCandidate?: ((receiptId: string) => void) | undefined;
    /** Present when the surface can re-ask, so a clarification stays actionable. */
    readonly onConfirmCandidates?: ((choices: readonly ClarificationChoice[]) => void) | undefined;
    readonly pending?: boolean | undefined;
    readonly chosenSubject?: SubjectRef | undefined;
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
export function EnrichmentView({
    result,
    composition,
    selectedCandidateReceiptIds,
    onToggleCandidate,
    onConfirmCandidates,
    pending = false,
    chosenSubject,
}: EnrichmentViewProps) {
    // A clarification does NO parser or validation work. The status check has
    // to be inside the memo rather than an early return before it, because
    // hooks must run unconditionally — but the effect is the same: for a
    // clarification, validateEnrichment is never called.
    const isClarification = result.status === "clarification_required";
    const validation = useMemo(
        () =>
            isClarification
                ? undefined
                : validateEnrichment(composition, result, PRESENTATION_MANIFEST_V1),
        [composition, result, isClarification],
    );

    // A runtime failure belongs to ONE result and composition, not to the
    // component. Latching it across a new result meant a single bad render
    // forced every later valid result into fallback for the life of the
    // session — the fail-closed-latch sibling of onError-firing-on-success, and
    // just as invisible, because fallback always looks like the safe outcome.
    //
    // Keyed state rather than an effect: clearing on a new result is per-result
    // state, not a retry.
    const renderKey = `${result.result_id}\u0000${composition}`;
    const [failureFor, setFailureFor] = useState<
        { readonly key: string; readonly message: string } | undefined
    >(undefined);
    const runtimeFailure = renderFailureFor(failureFor, renderKey);

    // A clarification is an INTERACTION, not an answer to present. The closed
    // component library has no candidate or choice component, and adding one
    // would put an interactive control under model composition. So a
    // clarification never enters the enrichment path: it routes to the
    // deterministic panel, which can actually offer the choice.
    //
    // Without this, an enrichment render of a clarification showed an empty
    // answer with no way to re-ask — a choiceless dead end.
    if (isClarification) {
        return (
            <div>
                <section className="panel" aria-label="Enrichment not applicable">
                    <h2 className="panel__title">Enrichment not applicable</h2>
                    {/* Callback-aware, deliberately. This copy used to promise
                        "where the choice can be made" unconditionally while the
                        panel it defers to correctly said re-asking was
                        unavailable — so a read-only caller was directed
                        somewhere that would refuse them. A wrapper must not
                        claim more than the component it defers to will deliver;
                        that is the same property-lives-in-the-component rule as
                        X2, applied to what the UI SAYS rather than what it
                        renders. */}
                    <p className="answer__body">
                        {onConfirmCandidates === undefined
                            ? "This result asks for a subject choice rather than presenting an answer. It is shown below for inspection; this context cannot re-ask."
                            : "This result asks for a subject choice rather than presenting an answer, so it is shown in the deterministic view where the choice can be made."}
                    </p>
                </section>
                <DeterministicAnswerView
                    chosenSubject={chosenSubject}
                    onConfirmCandidates={onConfirmCandidates}
                    onToggleCandidate={onToggleCandidate}
                    pending={pending}
                    result={result}
                    selectedCandidateReceiptIds={selectedCandidateReceiptIds}
                />
            </div>
        );
    }

    const violations: readonly EnrichmentViolation[] =
        validation === undefined || validation.ok ? [] : validation.violations;
    const fellBack = validation === undefined || !validation.ok || runtimeFailure !== undefined;

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
                <DeterministicAnswerView
                    chosenSubject={chosenSubject}
                    onConfirmCandidates={onConfirmCandidates}
                    onToggleCandidate={onToggleCandidate}
                    pending={pending}
                    result={result}
                    selectedCandidateReceiptIds={selectedCandidateReceiptIds}
                />
            </div>
        );
    }

    return (
        <EnrichmentResultProvider result={result}>
            <Renderer
                response={composition}
                library={enrichmentLibrary}
                toolProvider={null}
                // Setting state from onError is SAFE, and the reason is
                // structural rather than incidental: OpenUI invokes it from
                // ElementErrorBoundary.componentDidCatch (react-lang
                // Renderer.tsx:73-116), which is a COMMIT-phase lifecycle, not
                // render. A probe capturing console.error across a
                // runtime-failing render recorded zero calls and zero "Cannot
                // update a component while rendering" warnings; the test below
                // this component pins that.
                onError={(errors) => {
                    // OpenUI calls onError with an EMPTY array on a clean
                    // render, not only when something failed. Treating any call
                    // as a failure made the enriched view fall back every time,
                    // permanently — a fail-closed path firing on success is
                    // still a bug, and a quiet one, because falling back always
                    // *looks* like the safe outcome.
                    if (errors.length === 0) return;
                    setFailureFor({
                        key: renderKey,
                        message: errors
                            .map((error) => `${error.code}: ${error.message}`)
                            .join("; "),
                    });
                }}
            />
        </EnrichmentResultProvider>
    );
}
