import type { ReactNode } from "react";

export type DetailsProps = {
    /** The always-visible collapsed label — a short phrase, never a full sentence of content. */
    readonly summary: ReactNode;
    readonly children: ReactNode;
    /** Extra class names on the wrapping `<details>`, composed with `.details`. */
    readonly className?: string;
    /** Test hook, threaded onto the `<details>` element. */
    readonly "data-testid"?: string;
};

/**
 * CHAOS-4669: the shared "▸Details" collapse used across the answer surface —
 * computation arithmetic, per-driver breakdowns, raw evidence ids, and the
 * rest of the apparatus 4581/4669 push behind a fold rather than inline.
 *
 * A native `<details>`/`<summary>` pair, not a hand-rolled toggle: it is
 * keyboard- and screen-reader-operable for free, and it fails OPEN if JS
 * never hydrates (a collapsed-by-default custom widget with no JS would
 * fail CLOSED — silently hiding content with no way to reach it). Always
 * starts collapsed (no `open` attribute) — every call site opts a reader IN
 * to the apparatus, never the other way around.
 */
export function Details({ summary, children, className, "data-testid": testId }: DetailsProps) {
    return (
        <details
            className={className === undefined ? "details" : `details ${className}`}
            data-testid={testId}
        >
            <summary className="details__summary">{summary}</summary>
            <div className="details__body">{children}</div>
        </details>
    );
}
