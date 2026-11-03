import type { PopupPage } from "../../lib/clarification-popup";

export type AnsweredOffersProps = {
    /** The offers the answer carries (the same pages the popup shows). */
    readonly pages: readonly PopupPage[];
    /** The served label of the window the answer read, when one of the offers names it. */
    readonly windowLabel: string | undefined;
    /** Opens the popup on these offers. */
    readonly onOpen: () => void;
    readonly pending?: boolean | undefined;
};

/**
 * CHAOS-12725: the offers an ANSWER carries, as a control under the answer. The popup no longer
 * opens on its own over an answer (it covered the chart); the reader opens it here. Labels are
 * served words (CHAOS-4690); the only words of ours are the control names.
 */
export function AnsweredOffers({ pages, windowLabel, onOpen, pending }: AnsweredOffersProps) {
    if (pages.length === 0) return null;
    return (
        <div aria-label="Answer offers" className="chat__answered-offers" role="group">
            {pages.map((page) =>
                page.key === "window" ? (
                    <span className="chat__answered-offer" key={page.key}>
                        {windowLabel === undefined ? null : (
                            <span className="chat__answered-offer-value">{windowLabel}</span>
                        )}
                        <button
                            className="chat__answered-offer-change"
                            disabled={pending === true}
                            onClick={onOpen}
                            type="button"
                        >
                            Change period
                        </button>
                    </span>
                ) : (
                    <button
                        className="chat__answered-offer-change"
                        disabled={pending === true}
                        key={page.key}
                        onClick={onOpen}
                        type="button"
                    >
                        {page.title}
                    </button>
                ),
            )}
        </div>
    );
}
