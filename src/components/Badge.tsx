import type { Tone } from "../lib/presentation";

export type BadgeProps = {
    readonly tone: Tone;
    readonly children: React.ReactNode;
    /** The raw contract term, for tests. Never a `title`: a user would read it (CHAOS-12406). */
    readonly "data-value"?: string;
    /** A tooltip in plain words. The Workbench's own tools use it; the render does not. */
    readonly title?: string;
};

export function Badge({ tone, children, title, "data-value": value }: BadgeProps) {
    return (
        <span className={`badge badge--${tone}`} data-value={value} title={title}>
            {children}
        </span>
    );
}
