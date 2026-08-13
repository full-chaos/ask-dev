"use client";

import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

/**
 * The CLOSED enrichment component library (CHAOS-3738).
 *
 * Verified empirically: `createLibrary` builds its registry only from the
 * components passed here, with no ambient standard library — OpenUI's own
 * `Stack`/`TextContent` are rejected as `unknown-component` against this
 * library. So "the model may use only our components" is enforced by the
 * renderer, not by prompting.
 *
 * Every renderer below is deliberately dull. Each one:
 *
 *   - renders text as a React text child, NEVER via dangerouslySetInnerHTML,
 *     so a string that looks like markup stays a string;
 *   - takes no `className`, `style`, `href`, or `src` prop, so there is no
 *     field through which CSS, a URL, or an embed could arrive;
 *   - declares no action, so `@OpenUrl` and `@ToAssistant` have nothing to
 *     attach to.
 *
 * Material props are typed as strings here because they carry `@result.`
 * REFERENCES, not values. The values are resolved from the immutable result at
 * render time by the enrichment view. Validation guarantees every one of them
 * resolved before this library is ever mounted.
 */

const ref = z.string();

export const EvidenceRef = defineComponent({
    name: "EvidenceRef",
    description: "One canonical evidence reference id from the result.",
    props: z.object({ evidenceRefId: ref }),
    component: () => null,
});

export const Prose = defineComponent({
    name: "Prose",
    description: "Answer prose taken verbatim from the result, with inline evidence.",
    props: z.object({ text: ref, evidence: z.array(EvidenceRef.ref).optional() }),
    component: () => null,
});

export const DriverCard = defineComponent({
    name: "DriverCard",
    description: "One driver judgment from the result.",
    props: z.object({
        title: ref,
        summary: ref,
        standing: ref,
        confidence: ref,
        evidence: z.array(EvidenceRef.ref).optional(),
    }),
    component: () => null,
});

export const FindingCard = defineComponent({
    name: "FindingCard",
    description: "One finding from remaining work, readiness gaps, or conflicts.",
    props: z.object({
        kind: ref,
        summary: ref,
        evidence: z.array(EvidenceRef.ref).optional(),
    }),
    component: () => null,
});

export const ComparisonRow = defineComponent({
    name: "ComparisonRow",
    description: "One labelled row of a comparison.",
    props: z.object({ label: ref, value: ref }),
    component: () => null,
});

export const Comparison = defineComponent({
    name: "Comparison",
    description: "A table or side-by-side comparison built from result values.",
    props: z.object({
        layout: z.enum(["rows", "columns"]).optional(),
        rows: z.array(ComparisonRow.ref),
    }),
    component: () => null,
});

export const Metric = defineComponent({
    name: "Metric",
    description: "A single metric value from the result.",
    props: z.object({
        label: ref,
        value: ref,
        trend: z.enum(["up", "down", "flat", "unknown"]).optional(),
    }),
    component: () => null,
});

export const TimelineEntry = defineComponent({
    name: "TimelineEntry",
    description: "One observed point on a timeline.",
    props: z.object({ label: ref, observedAt: ref }),
    component: () => null,
});

export const Timeline = defineComponent({
    name: "Timeline",
    description: "An ordered sequence of observed points.",
    props: z.object({ entries: z.array(TimelineEntry.ref) }),
    component: () => null,
});

export const RelationshipEdgeView = defineComponent({
    name: "RelationshipEdgeView",
    description: "One edge of a relationship path.",
    props: z.object({ from: ref, to: ref, type: ref }),
    component: () => null,
});

export const RelationshipPathView = defineComponent({
    name: "RelationshipPathView",
    description: "One relationship path with the edges that make it up.",
    props: z.object({
        pathId: ref,
        whyRelevant: ref,
        edges: z.array(RelationshipEdgeView.ref),
    }),
    component: () => null,
});

export const CoverageSource = defineComponent({
    name: "CoverageSource",
    description: "One source observation and its contract state.",
    props: z.object({ source: ref, state: ref }),
    component: () => null,
});

export const Coverage = defineComponent({
    name: "Coverage",
    description: "What the investigation could and could not read. Mandatory.",
    props: z.object({ partial: ref, sources: z.array(CoverageSource.ref) }),
    component: () => null,
});

export const LimitationItem = defineComponent({
    name: "LimitationItem",
    description: "One limitation stated by the result.",
    props: z.object({ text: ref }),
    component: () => null,
});

export const Limitations = defineComponent({
    name: "Limitations",
    description: "What the service said it cannot support. Mandatory.",
    props: z.object({ items: z.array(LimitationItem.ref) }),
    component: () => null,
});

export const DataTrustPanel = defineComponent({
    name: "DataTrustPanel",
    description: "Backend and version provenance for the result.",
    props: z.object({ backend: ref, projectionVersion: ref, queryVersion: ref }),
    component: () => null,
});

export const Answer = defineComponent({
    name: "Answer",
    description: "Root of an enriched answer.",
    props: z.object({
        headline: ref,
        sections: z.array(
            z.union([
                Prose.ref,
                DriverCard.ref,
                FindingCard.ref,
                Comparison.ref,
                Metric.ref,
                Timeline.ref,
                RelationshipPathView.ref,
                Coverage.ref,
                Limitations.ref,
                DataTrustPanel.ref,
            ]),
        ),
    }),
    component: () => null,
});

export const enrichmentLibrary = createLibrary({
    root: "Answer",
    components: [
        Answer,
        Prose,
        EvidenceRef,
        DriverCard,
        FindingCard,
        Comparison,
        ComparisonRow,
        Metric,
        Timeline,
        TimelineEntry,
        RelationshipPathView,
        RelationshipEdgeView,
        Coverage,
        CoverageSource,
        Limitations,
        LimitationItem,
        DataTrustPanel,
    ],
});
