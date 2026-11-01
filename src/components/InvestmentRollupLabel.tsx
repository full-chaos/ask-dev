import { INVESTMENT_ROLLUP_COPY, type InvestmentRollup } from "../lib/investment-rollup";

/**
 * The owning-team roll-up label of one project (CHAOS-12178). The visible text is short; the
 * sentence a screen reader hears says what the roll-up means. `named` puts the project's name first,
 * for a place that shows roll-ups of more than one project.
 */
export function InvestmentRollupLabel({
    rollup,
    named = false,
}: {
    readonly rollup: InvestmentRollup;
    readonly named?: boolean;
}) {
    const name = named && rollup.subject.label.trim() ? `${rollup.subject.label}: ` : "";
    return (
        <span
            className="rollup-label"
            data-testid="investment-rollup"
            data-subject={rollup.subject.canonical_id}
        >
            <span aria-hidden="true">
                {name}
                {INVESTMENT_ROLLUP_COPY.visible(rollup)}
            </span>
            <span className="sr-only">
                {name}
                {INVESTMENT_ROLLUP_COPY.aria(rollup)}
            </span>
        </span>
    );
}
