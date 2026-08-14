"use client";

import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

import { useResolvedRef } from "@/lib/enrichment/context";

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
 * REFERENCES, not values. Each renderer resolves them through
 * `useResolvedRef`, against the one result the composition was validated
 * against. Validation has already proved every reference resolves before this
 * library is ever mounted, so a resolution failure here means the validated and
 * rendered compositions diverged — the error boundary catches it and the view
 * falls closed.
 */

/** Renders one reference prop as text. */
function Ref({ value }: { readonly value: unknown }) {
    return <>{useResolvedRef(value)}</>;
}

const ref = z.string();

export const EvidenceRef = defineComponent({
    name: "EvidenceRef",
    description: "One canonical evidence reference id from the result.",
    props: z.object({ evidenceRefId: ref }),
    component: ({ props }) => (
        <li className="evidence-ref">
            <Ref value={props.evidenceRefId} />
        </li>
    ),
});

export const Prose = defineComponent({
    name: "Prose",
    description: "Answer prose taken verbatim from the result, with inline evidence.",
    props: z.object({ text: ref, evidence: z.array(EvidenceRef.ref).optional() }),
    component: ({ props, renderNode }) => (
        <div className="panel">
            <p className="answer__body">
                <Ref value={props.text} />
            </p>
            {props.evidence === undefined ? null : (
                <ul className="evidence-list">{renderNode(props.evidence)}</ul>
            )}
        </div>
    ),
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
    component: ({ props, renderNode }) => (
        <div className="record">
            <div className="record__head">
                <span className="record__title">
                    <Ref value={props.title} />
                </span>
                <span className="badge">
                    <Ref value={props.standing} />
                </span>
                <span className="record__meta">
                    confidence <Ref value={props.confidence} />
                </span>
            </div>
            <p className="record__body">
                <Ref value={props.summary} />
            </p>
            {props.evidence === undefined ? null : (
                <ul className="evidence-list">{renderNode(props.evidence)}</ul>
            )}
        </div>
    ),
});

export const FindingCard = defineComponent({
    name: "FindingCard",
    description: "One finding from remaining work, readiness gaps, or conflicts.",
    props: z.object({
        kind: ref,
        summary: ref,
        evidence: z.array(EvidenceRef.ref).optional(),
    }),
    component: ({ props, renderNode }) => (
        <div className="record">
            <span className="record__title">
                <Ref value={props.kind} />
            </span>
            <p className="record__body">
                <Ref value={props.summary} />
            </p>
            {props.evidence === undefined ? null : (
                <ul className="evidence-list">{renderNode(props.evidence)}</ul>
            )}
        </div>
    ),
});

export const ComparisonRow = defineComponent({
    name: "ComparisonRow",
    description: "One labelled row of a comparison.",
    props: z.object({ label: ref, value: ref }),
    component: ({ props }) => (
        <tr>
            <th scope="row">
                <Ref value={props.label} />
            </th>
            <td>
                <Ref value={props.value} />
            </td>
        </tr>
    ),
});

export const Comparison = defineComponent({
    name: "Comparison",
    description: "A table or side-by-side comparison built from result values.",
    props: z.object({
        layout: z.enum(["rows", "columns"]).optional(),
        rows: z.array(ComparisonRow.ref),
    }),
    component: ({ props, renderNode }) => (
        <table className="comparison">
            <tbody>{renderNode(props.rows)}</tbody>
        </table>
    ),
});

export const Metric = defineComponent({
    name: "Metric",
    description: "A single metric value from the result.",
    props: z.object({
        label: ref,
        value: ref,
        trend: z.enum(["up", "down", "flat", "unknown"]).optional(),
    }),
    component: ({ props }) => (
        <div className="record">
            <span className="record__meta">
                <Ref value={props.label} />
            </span>
            <p className="answer__judgment">
                <Ref value={props.value} />
            </p>
            {props.trend === undefined ? null : (
                <span className="record__meta">trend {String(props.trend)}</span>
            )}
        </div>
    ),
});

export const TimelineEntry = defineComponent({
    name: "TimelineEntry",
    description: "One observed point on a timeline.",
    props: z.object({ label: ref, observedAt: ref }),
    component: ({ props }) => (
        <li className="record">
            <span className="record__title">
                <Ref value={props.label} />
            </span>
            <span className="record__meta">
                <Ref value={props.observedAt} />
            </span>
        </li>
    ),
});

export const Timeline = defineComponent({
    name: "Timeline",
    description: "An ordered sequence of observed points.",
    props: z.object({ entries: z.array(TimelineEntry.ref) }),
    component: ({ props, renderNode }) => (
        <ol className="stack stack--tight">{renderNode(props.entries)}</ol>
    ),
});

export const RelationshipEdgeView = defineComponent({
    name: "RelationshipEdgeView",
    description: "One edge of a relationship path.",
    props: z.object({ from: ref, to: ref, type: ref }),
    component: ({ props }) => (
        <li className="record__meta">
            <Ref value={props.from} /> —<Ref value={props.type} />→ <Ref value={props.to} />
        </li>
    ),
});

export const RelationshipPathView = defineComponent({
    name: "RelationshipPathView",
    description: "One relationship path with the edges that make it up.",
    props: z.object({
        pathId: ref,
        whyRelevant: ref,
        edges: z.array(RelationshipEdgeView.ref),
    }),
    component: ({ props, renderNode }) => (
        <div className="record">
            <span className="record__title">
                <Ref value={props.pathId} />
            </span>
            <p className="record__body">
                <Ref value={props.whyRelevant} />
            </p>
            <ul className="stack stack--tight">{renderNode(props.edges)}</ul>
        </div>
    ),
});

export const CoverageSource = defineComponent({
    name: "CoverageSource",
    description: "One source observation and its contract state.",
    props: z.object({ source: ref, state: ref }),
    component: ({ props }) => (
        <div className="coverage__source">
            <span className="coverage__name">
                <Ref value={props.source} />
            </span>
            <span className="badge">
                <Ref value={props.state} />
            </span>
        </div>
    ),
});

export const Coverage = defineComponent({
    name: "Coverage",
    description: "What the investigation could and could not read. Mandatory.",
    props: z.object({ partial: ref, sources: z.array(CoverageSource.ref) }),
    component: ({ props, renderNode }) => (
        <section className="panel" aria-label="Coverage">
            <h3 className="panel__title">Coverage</h3>
            <p className="record__meta">
                partial: <Ref value={props.partial} />
            </p>
            <div className="coverage">{renderNode(props.sources)}</div>
        </section>
    ),
});

export const LimitationItem = defineComponent({
    name: "LimitationItem",
    description: "One limitation stated by the result.",
    props: z.object({ text: ref }),
    component: ({ props }) => (
        <li className="record">
            <Ref value={props.text} />
        </li>
    ),
});

export const Limitations = defineComponent({
    name: "Limitations",
    description: "What the service said it cannot support. Mandatory.",
    props: z.object({ items: z.array(LimitationItem.ref) }),
    component: ({ props, renderNode }) => (
        <section className="panel" aria-label="Limitations">
            <h3 className="panel__title">Limitations</h3>
            <ul className="stack stack--tight">{renderNode(props.items)}</ul>
        </section>
    ),
});

export const DataTrustPanel = defineComponent({
    name: "DataTrustPanel",
    description: "Backend and version provenance for the result.",
    props: z.object({ backend: ref, projectionVersion: ref, queryVersion: ref }),
    component: ({ props }) => (
        <section className="panel" aria-label="Data trust">
            <h3 className="panel__title">Data trust</h3>
            <dl className="versions">
                <div>
                    <dt>backend</dt>
                    <dd>
                        <Ref value={props.backend} />
                    </dd>
                </div>
                <div>
                    <dt>projection</dt>
                    <dd>
                        <Ref value={props.projectionVersion} />
                    </dd>
                </div>
                <div>
                    <dt>query</dt>
                    <dd>
                        <Ref value={props.queryVersion} />
                    </dd>
                </div>
            </dl>
        </section>
    ),
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
    component: ({ props, renderNode }) => (
        <article aria-label="Enriched answer">
            <h2 className="answer__judgment">
                <Ref value={props.headline} />
            </h2>
            {renderNode(props.sections)}
        </article>
    ),
});

/**
 * The production component set. Exported so a test can build a library with an
 * EXTRA component without that component ever entering the production registry
 * — see `enrichmentLibrary` below, which is built from this list alone.
 */
export const enrichmentComponents = [
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
];

export const enrichmentLibrary = createLibrary({
    root: "Answer",
    components: enrichmentComponents,
});
