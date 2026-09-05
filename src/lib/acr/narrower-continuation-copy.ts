import type { NarrowingContinuationAxis } from "@/lib/acr/upstream-vocabulary";

/**
 * CHAOS-5107 (CHAOS-4735's client half). ACR's engine names WHICH structural
 * axis of a question could be reduced to fit the response budget, as a
 * closed token — it does not, and by chris's 2026-08-31 ruling (E-6 in
 * .remember/lanes/lane-astra-synthesis/proposal-2026-09-04.md) MAY NOT,
 * phrase that claim in English. This file is where the phrasing happens: the
 * ONLY place in the Workbench that turns a `narrower_continuation.axis` into
 * a sentence or a re-ask question.
 *
 * Keyed on axis alone, not axis+family: the axis is the actionable
 * structural dimension a tester can do something about from here (fewer
 * results, a shorter window, a narrower scope); `family` rides along on the
 * wire for diagnosis but this Workbench does not phrase per-family copy.
 */
export type NarrowerContinuationCopy = {
    /** Shown on the one-click button. */
    readonly actionLabel: string;
    /** Shown beside the button, explaining what the tester is about to try. */
    readonly explanation: string;
    /**
     * Builds the re-ask question from the TESTER'S OWN original question
     * text. Never a corpus/fixture question — the caller supplies the text
     * that was actually typed, and this function only appends a
     * client-authored qualifying clause to it.
     */
    readonly narrowQuestion: (originalQuestion: string) => string;
};

/** Strips a trailing `?`/`.`/`!` run so an appended clause reads naturally. */
function withoutTrailingPunctuation(question: string): string {
    const trimmed = question.trim();
    const stripped = trimmed.replace(/[!.?]+$/u, "");
    return stripped.length > 0 ? stripped : trimmed;
}

export const narrowerContinuationCopy: Record<NarrowingContinuationAxis, NarrowerContinuationCopy> =
    {
        evidence_window: {
            actionLabel: "Ask over a shorter window",
            explanation:
                "This answer needed more history than fits one response. Asking about a shorter period narrows it.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, over the last 7 days?`,
        },
        result_count: {
            actionLabel: "Ask for fewer results",
            explanation:
                "This answer had more results than fit one response. Asking for a smaller number narrows it.",
            narrowQuestion: (question) => `${withoutTrailingPunctuation(question)}, top 5 only?`,
        },
        scope_anchor: {
            actionLabel: "Ask about a narrower scope",
            explanation:
                "This answer covered more than fits one response. Scoping the question to one team or project narrows it.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, for just one team?`,
        },
        group_selection: {
            actionLabel: "Ask about fewer groups",
            explanation:
                "This answer covered more groups than fit one response. Asking about fewer groups at a time narrows it.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, for the top group only?`,
        },
        comparison_pair: {
            actionLabel: "Compare fewer subjects",
            explanation:
                "This comparison had more subjects than fit one response. Comparing fewer of them at a time narrows it.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, comparing just two of them?`,
        },
    };

/**
 * A client-authored sentence naming which budget ceiling was exceeded, when
 * ACR reported one. Built ONLY from two closed-vocabulary tokens
 * (`overrun`) and two measured counts (`measuredItems`/`maxItems`) — never
 * from ACR's own `error.message`, which this Workbench never reads at all
 * (see `UpstreamError` in `@/lib/acr/client`).
 */
export function describeBudgetOverrun(details: {
    readonly overrun?: string | undefined;
    readonly measuredItems?: number | undefined;
    readonly maxItems?: number | undefined;
}): string | undefined {
    if (
        details.overrun === "items" &&
        details.measuredItems !== undefined &&
        details.maxItems !== undefined
    ) {
        return `The answer would have included ${String(details.measuredItems)} items; only ${String(details.maxItems)} fit one response.`;
    }
    if (details.overrun === "bytes") {
        return "The answer would have been larger than one response allows.";
    }
    return undefined;
}
