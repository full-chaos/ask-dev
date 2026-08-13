"use client";

/**
 * The three views the spec requires, off one immutable result.
 *
 * `enriched` is declared here but disabled until M3 lands its manifest, closed
 * component library, and fail-closed validator. It is listed rather than hidden
 * so the shape of the surface is honest about what is not built yet.
 */
export const workbenchViews = ["raw", "deterministic", "enriched"] as const;

export type WorkbenchView = (typeof workbenchViews)[number];

const VIEW_LABELS: Record<WorkbenchView, string> = {
    raw: "Canonical result",
    deterministic: "Deterministic answer",
    enriched: "Enriched (OpenUI)",
};

export type ViewSwitcherProps = {
    readonly active: WorkbenchView;
    readonly available: readonly WorkbenchView[];
    readonly onSelect: (view: WorkbenchView) => void;
};

export function ViewSwitcher({ active, available, onSelect }: ViewSwitcherProps) {
    return (
        <div className="view-switcher" role="tablist" aria-label="Result views">
            {workbenchViews.map((view) => {
                const enabled = available.includes(view);
                return (
                    <button
                        key={view}
                        type="button"
                        role="tab"
                        aria-selected={active === view}
                        disabled={!enabled}
                        className={`view-switcher__tab${active === view ? " view-switcher__tab--active" : ""}`}
                        onClick={() => onSelect(view)}
                        title={enabled ? undefined : "Not available until M3"}
                    >
                        {VIEW_LABELS[view]}
                    </button>
                );
            })}
        </div>
    );
}
