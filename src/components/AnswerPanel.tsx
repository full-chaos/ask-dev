import { useId } from "react";

import { SafeAnswerText } from "@/components/SafeAnswerText";
import type { InvestigationResult } from "@/lib/contracts";
import { splitLeadArithmetic } from "@/lib/prose-detail";

export type AnswerPanelProps = {
    readonly result: InvestigationResult;
};

/**
 * The answer as the service stated it — narrative prose only.
 *
 * CHAOS-4581: prose now reads AFTER the decision-carrying panels (ranked
 * teams / driver cards / coverage strip — see `DeterministicAnswerView`'s own
 * ordering comment). The one-line answer is NEVER hidden behind a click
 * (team-lead correction, 2026-08-30): `deterministic_answer` (the service's
 * own non-model wording) and `direct_judgment` (the judgment sentence, or an
 * explicit "no direct judgment" when the service sent none) are both always
 * visible. Only `current_state` — the field where a long fact dump tends to
 * land (CHAOS-4580 is shrinking that on the acr side) — sits behind a closed
 * `<details>`, so whatever prose arrives there never reintroduces a wall of
 * text between the panels and the fold. Nothing is summarized, reordered by
 * importance, or filled with the workbench's own words.
 * `strongest_pressures` and `drivers` moved out to `DriversPanel`
 * (CHAOS-4581) — a panel, not prose.
 *
 * CHAOS-4669 defect 2 (confirmed LIVE, kiac org 70d529e0, "Which teams are
 * struggling, and why?"): `deterministic_answer` itself can carry acr's
 * driver-scoring TEMPLATE sentence verbatim — "readiness gap (weight 15,
 * value 1.00) contributed 20.0 of Fullchaos's 46.7 attention points." — a
 * structured restatement of what `DriversPanel`'s own cards already state
 * per driver, not narrative prose. `splitLeadArithmetic` pulls exactly that
 * templated shape out of `deterministic_answer`/`direct_judgment`, LOSSLESS
 * (every character preserved verbatim, just moved) into the SAME "More
 * detail" fold `current_state` already uses — never paraphrased, dropped,
 * or reworded, so this stays inside the "nothing summarized" boundary
 * above: a presentational split of one field's own text, not a rewrite.
 */
export function AnswerPanel({ result }: AnswerPanelProps) {
    // CHAOS-4510 (fixed here — in scope because this panel is rewritten by
    // CHAOS-4581): the chat surface keeps every answered turn mounted, so a
    // hardcoded heading id collided across turns and every later turn's
    // `aria-labelledby` resolved to the FIRST turn's heading.
    const idPrefix = useId();
    const deterministicAnswer = splitLeadArithmetic(result.deterministic_answer);
    const directJudgment = splitLeadArithmetic(result.direct_judgment);
    // codex round 2, finding 4: this must reflect the ORIGINAL field, not
    // the post-extraction lead. An arithmetic-only `direct_judgment` is
    // fully extracted into `More detail` (lossless — see this file's own
    // doc comment), leaving `directJudgment.lead` empty; testing THAT for
    // "no judgment" falsely claimed the service sent none, when its
    // content is sitting, verbatim, one click away.
    const hasJudgment = result.direct_judgment.trim() !== "";
    const hasCurrentState = result.current_state.trim() !== "";
    const arithmeticSentences = [...deterministicAnswer.extracted, ...directJudgment.extracted];
    const hasDetail = hasCurrentState || arithmeticSentences.length > 0;
    return (
        <section
            className="panel"
            aria-labelledby={`${idPrefix}-answer-title`}
            data-testid="answer-panel"
        >
            <h2 className="panel__title" id={`${idPrefix}-answer-title`}>
                Answer
            </h2>
            {deterministicAnswer.lead !== "" ? (
                <p className="answer__judgment">
                    <SafeAnswerText text={deterministicAnswer.lead} />
                </p>
            ) : null}
            {hasJudgment ? (
                // `directJudgment.lead` can still be "" here when the whole
                // field was the arithmetic template — its content already
                // moved to `More detail` below (`arithmeticSentences`), so
                // there is nothing left to show on the lead surface, and no
                // empty paragraph is rendered either.
                directJudgment.lead !== "" ? (
                    <p className="answer__body">
                        <SafeAnswerText text={directJudgment.lead} />
                    </p>
                ) : null
            ) : (
                <p className="panel__empty">The service returned no direct judgment.</p>
            )}
            {hasDetail ? (
                <details className="disclosure">
                    <summary>More detail</summary>
                    {arithmeticSentences.length > 0 ? (
                        <div data-testid="answer-arithmetic-detail">
                            {arithmeticSentences.map((sentence) => (
                                <p className="record__meta" key={sentence}>
                                    <SafeAnswerText text={sentence} />
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {hasCurrentState ? (
                        <p className="answer__body">
                            <SafeAnswerText text={result.current_state} />
                        </p>
                    ) : null}
                </details>
            ) : null}
        </section>
    );
}
