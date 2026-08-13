/**
 * The Dev Health-owned presentation manifest (CHAOS-3738).
 *
 * The manifest — not OpenUI — is the product boundary. It declares the closed
 * set of components an enrichment composition may use, which of their props are
 * material (and therefore reference-only), the closed vocabularies their
 * non-material props may draw from, and which sections a composition MUST
 * contain to be renderable at all.
 *
 * It is reference-only by construction: no manifest field carries an answer, a
 * fact, a metric, or a judgment. It carries section headings and layout
 * vocabulary, and nothing else.
 *
 * OpenUI is a replaceable adapter beneath this. Swapping it out means
 * reimplementing `validate.ts` and `library.tsx`; the manifest does not change.
 */

export type ManifestComponent = {
    readonly name: string;
    /** Props that carry material values. Every one MUST be a `@result.` reference. */
    readonly materialProps: readonly string[];
    /** Props drawn from a closed vocabulary declared here, never from the model. */
    readonly enumProps?: Readonly<Record<string, readonly string[]>>;
    /** Props naming a child component list. */
    readonly childProps?: readonly string[];
};

export type PresentationManifest = {
    readonly manifestVersion: string;
    /** The only component a composition may use as its root. */
    readonly root: string;
    readonly components: readonly ManifestComponent[];
    /**
     * Sections a composition MUST include. Omitting one fails the composition
     * closed — this is what stops an enriched view quietly dropping coverage or
     * limitations and looking more confident than the result justifies.
     */
    readonly mandatorySections: readonly string[];
};

/**
 * The v1 manifest.
 *
 * Component coverage tracks the spec's list: answer prose with inline evidence,
 * findings and driver cards, tables and comparisons, metric/trend, timelines
 * and relationship views, and limitations plus data-trust panels.
 */
export const PRESENTATION_MANIFEST_V1: PresentationManifest = {
    manifestVersion: "ask_dev_presentation_manifest.v1",
    root: "Answer",
    mandatorySections: ["Coverage", "Limitations"],
    components: [
        {
            name: "Answer",
            materialProps: ["headline"],
            childProps: ["sections"],
        },
        {
            name: "Prose",
            materialProps: ["text"],
            childProps: ["evidence"],
        },
        {
            name: "EvidenceRef",
            materialProps: ["evidenceRefId"],
        },
        {
            name: "DriverCard",
            materialProps: ["title", "summary", "standing", "confidence"],
            childProps: ["evidence"],
        },
        {
            name: "FindingCard",
            materialProps: ["kind", "summary"],
            childProps: ["evidence"],
        },
        {
            name: "Comparison",
            materialProps: [],
            enumProps: { layout: ["rows", "columns"] },
            childProps: ["rows"],
        },
        {
            name: "ComparisonRow",
            materialProps: ["label", "value"],
        },
        {
            name: "Metric",
            materialProps: ["label", "value"],
            enumProps: { trend: ["up", "down", "flat", "unknown"] },
        },
        {
            name: "Timeline",
            materialProps: [],
            childProps: ["entries"],
        },
        {
            name: "TimelineEntry",
            materialProps: ["label", "observedAt"],
        },
        {
            name: "RelationshipPathView",
            materialProps: ["pathId", "whyRelevant"],
            childProps: ["edges"],
        },
        {
            name: "RelationshipEdgeView",
            materialProps: ["from", "to", "type"],
        },
        {
            name: "Coverage",
            materialProps: ["partial"],
            childProps: ["sources"],
        },
        {
            name: "CoverageSource",
            materialProps: ["source", "state"],
        },
        {
            name: "Limitations",
            materialProps: [],
            childProps: ["items"],
        },
        {
            name: "LimitationItem",
            materialProps: ["text"],
        },
        {
            name: "DataTrustPanel",
            materialProps: ["backend", "projectionVersion", "queryVersion"],
        },
    ],
};

export function manifestComponent(
    manifest: PresentationManifest,
    name: string,
): ManifestComponent | undefined {
    return manifest.components.find((component) => component.name === name);
}
