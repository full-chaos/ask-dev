import type { Tone } from "@/lib/presentation";

export type BadgeProps = {
    readonly tone: Tone;
    readonly children: React.ReactNode;
    /** The raw contract term, surfaced as a tooltip so the tone never hides it. */
    readonly title?: string;
};

export function Badge({ tone, children, title }: BadgeProps) {
    return (
        <span className={`badge badge--${tone}`} title={title}>
            {children}
        </span>
    );
}
