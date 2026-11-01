import type { WorkbenchFailure } from "./errors";
import type { NarrowingContinuationAxis } from "./upstream-vocabulary";

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
 *
 * CHAOS-12406: a budget refusal says web's words (`REFUSAL_COPY`, each
 * `explanation`, `describeBudgetOverrun`), copied exactly: one render, one
 * wording. The button's label and the clause a re-ask appends stay ask-dev's:
 * its re-ask appends a clause and goes through the composer.
 */
export type NarrowerContinuationCopy = {
    /** Shown on the one-click button. */
    readonly actionLabel: string;
    /** The sentence that says what a narrower question would be. */
    readonly explanation: string;
    /**
     * Builds the re-ask question from the TESTER'S OWN original question
     * text. Never a corpus/fixture question — the caller supplies the text
     * that was actually typed, and this function only appends a
     * client-authored qualifying clause to it.
     */
    readonly narrowQuestion: (originalQuestion: string) => string;
};

/**
 * The button's label while the narrowed re-ask is in flight. Lives here,
 * not as a literal inside `NarrowerReask.tsx`, so every word the tester sees
 * for this feature stays in the one file this header comment promises —
 * codex review round 1 caught the literal living in the component instead.
 */
export const NARROWER_REASK_PENDING_LABEL = "Asking…";

/** Words of a budget refusal. ACR sends tokens and numbers only. */
export const REFUSAL_COPY = {
    status: "No answer: too large to send",
    lead: "The answer to this question was too large to send.",
    overrunItems: (measured: number, max: number) =>
        `It held ${measured.toLocaleString("en-US")} items; an answer can hold ${max.toLocaleString("en-US")}.`,
    overrunBytes: (measured: string, max: string) => `It was ${measured}; an answer can be ${max}.`,
    nothingLeftToCut: "Nothing more could be cut from it.",
    sameAgain: "Asking the same question again gives the same result.",
    noAxis: "No narrower form of this question can be suggested.",
} as const;

/**
 * Whether a failure is a budget refusal. `budget_refusal` is ACR's code for one, and a 413 is one
 * whatever its code says: ACR's route has sent `invalid_request` on it, and the client carries a
 * refusal's fields on the status alone. A host names it either way.
 */
export function isBudgetRefusal(
    failure: Pick<WorkbenchFailure, "httpStatus" | "upstreamCode">,
): boolean {
    return failure.upstreamCode === "budget_refusal" || failure.httpStatus === 413;
}

/** Strips a trailing `?`/`.`/`!` run so an appended clause reads naturally. */
function withoutTrailingPunctuation(question: string): string {
    const trimmed = question.trim();
    const stripped = trimmed.replace(/[!.?]+$/u, "");
    return stripped.length > 0 ? stripped : trimmed;
}

/**
 * Reports whether `question` has no content worth narrowing.
 *
 * codex review round 2, P2: a question consisting ONLY of whitespace and/or
 * the punctuation `withoutTrailingPunctuation` strips (e.g. `"???"`) passed
 * a bare `.trim() !== ""` check, then rendered a re-ask button whose built
 * question was that same punctuation with a clause appended — nothing
 * meaningful was ever there to narrow. A question counts as blank here when
 * it has no character other than whitespace or `!`/`.`/`?`.
 */
export function isBlankQuestion(question: string): boolean {
    return !/[^\s!.?]/u.test(question);
}

export const narrowerContinuationCopy: Record<NarrowingContinuationAxis, NarrowerContinuationCopy> =
    {
        evidence_window: {
            actionLabel: "Ask over a shorter window",
            explanation: "Ask about a shorter time period.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, over the last 7 days?`,
        },
        result_count: {
            actionLabel: "Ask for fewer results",
            explanation: "Ask for fewer results, for example the top 10.",
            narrowQuestion: (question) => `${withoutTrailingPunctuation(question)}, top 5 only?`,
        },
        scope_anchor: {
            actionLabel: "Ask about a narrower scope",
            explanation: "Ask about a narrower scope, for example one project or one repository.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, for just one team?`,
        },
        group_selection: {
            actionLabel: "Ask about fewer groups",
            explanation: "Ask about fewer groups.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, for the top group only?`,
        },
        comparison_pair: {
            actionLabel: "Compare fewer subjects",
            explanation: "Compare fewer subjects at a time.",
            narrowQuestion: (question) =>
                `${withoutTrailingPunctuation(question)}, comparing just two of them?`,
        },
    };

const kilobytes = (bytes: number): string =>
    `${Math.ceil(bytes / 1024).toLocaleString("en-US")} KB`;

/**
 * A client-authored sentence naming which budget ceiling was exceeded, when
 * ACR reported one and its numbers. Built ONLY from a closed-vocabulary token
 * (`overrun`) and measured counts — never from ACR's own `error.message`,
 * which this Workbench never reads at all (see `UpstreamError` in
 * `@/lib/acr/client`).
 */
export function describeBudgetOverrun(details: {
    readonly overrun?: string | undefined;
    readonly measuredItems?: number | undefined;
    readonly maxItems?: number | undefined;
    readonly measuredBytes?: number | undefined;
    readonly maxBytes?: number | undefined;
}): string | undefined {
    if (
        details.overrun === "items" &&
        details.measuredItems !== undefined &&
        details.maxItems !== undefined
    ) {
        return REFUSAL_COPY.overrunItems(details.measuredItems, details.maxItems);
    }
    if (
        details.overrun === "bytes" &&
        details.measuredBytes !== undefined &&
        details.maxBytes !== undefined
    ) {
        return REFUSAL_COPY.overrunBytes(
            kilobytes(details.measuredBytes),
            kilobytes(details.maxBytes),
        );
    }
    return undefined;
}
