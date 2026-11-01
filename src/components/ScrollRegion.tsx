import type { ReactNode } from "react";

export type ScrollRegionProps = {
    /** What the table holds. A keyboard user lands here, so it needs a name. */
    readonly label: string;
    readonly children: ReactNode;
};

/**
 * A table that may be wider than its column. It scrolls sideways, so it must take focus, or a
 * keyboard user cannot reach what is cut off. A named group and not a region: an answer can hold
 * several, and landmarks must be unique.
 */
export function ScrollRegion({ label, children }: ScrollRegionProps) {
    return (
        <div aria-label={label} className="fact-table-wrap" role="group" tabIndex={0}>
            {children}
        </div>
    );
}
