import type { Tone } from "../lib/presentation";

export type BadgeProps = {
    readonly tone: Tone;
    readonly children: React.ReactNode;
    /** Words a reader may hover for. A raw contract term never goes here: see `data-value`. */
    readonly title?: string;
    /** The raw contract term, for tests and for a host. A user never reads it here. */
    readonly "data-value"?: string;
};

export function Badge({ tone, children, title, "data-value": value }: BadgeProps) {
    return (
        <span className={`badge badge--${tone}`} data-value={value} title={title}>
            {children}
        </span>
    );
}
