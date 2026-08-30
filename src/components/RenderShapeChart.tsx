import type { RenderShape } from "@/lib/contracts";

export type RenderShapeChartProps = {
    readonly shape: RenderShape;
};

const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 18, right: 12, bottom: 34, left: 12 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_AXIS_LABELS = 8;
const MAX_BAR_WIDTH = 88;
// Axis labels are drawn at fixed positions, so a long one overlaps its
// neighbours and obscures which bar it names (codex round 1, P3). Truncated
// for DISPLAY only: the full label is still in every mark's aria-label and
// in the accessible data table, so nothing is lost to a reader.
const MAX_AXIS_LABEL_CHARS = 18;

function axisLabelText(label: string): string {
    return label.length <= MAX_AXIS_LABEL_CHARS
        ? label
        : `${label.slice(0, MAX_AXIS_LABEL_CHARS - 1)}\u2026`;
}

// Fixed hue order (dataviz skill), never cycled. acr caps a shape at 8
// series, exactly the number of slots, so an index never wraps.
const SERIES_VARS = [
    "--series-1",
    "--series-2",
    "--series-3",
    "--series-4",
    "--series-5",
    "--series-6",
    "--series-7",
    "--series-8",
];

/**
 * Formats a plotted number WITHOUT turning it into a different one.
 *
 * Two decimals is a readable default, but `0.004` rounds to `0` — and this
 * contract exists so a chart number equals the fact it cites. In the
 * accessible table it is the only number a reader gets at all. So the short
 * form is used only when it round-trips to the same value; otherwise the
 * value is shown in full (codex round 1, P2).
 */
function formatValue(value: number): string {
    return String(value);
}

/**
 * The DRAWN form of a number: at most two decimals.
 *
 * Rounding a glyph is honest only because the exact value is always
 * reachable beside it — every mark carries the full value in its
 * `aria-label` and `<title>`, and the accessible table prints it in full via
 * `formatValue`. What is never allowed is rounding being the ONLY form a
 * reader can get, which is why the table uses the exact value and this is
 * used for drawn text alone.
 */
function formatDisplay(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** A rect with the top two corners rounded, anchored at the baseline. */
function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
    const radius = Math.max(0, Math.min(r, w / 2, h));
    if (radius === 0) return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
    return (
        `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} ` +
        `L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`
    );
}

/** Evenly-spaced label indices, always including the first and last. */
function labelIndices(count: number, maxLabels: number): Set<number> {
    if (count <= maxLabels) return new Set(Array.from({ length: count }, (_, i) => i));
    const step = (count - 1) / (maxLabels - 1);
    const indices = new Set<number>();
    for (let i = 0; i < maxLabels; i++) indices.add(Math.round(i * step));
    return indices;
}

/**
 * Every axis position in the shape, in the order acr sent them.
 *
 * Deliberately derived from the SERIES rather than assumed: a series with no
 * point at a label has a real gap there (acr never emits a zero for an
 * unmeasured member or family), so the axis is the union of what the series
 * actually carry, first-seen order preserved.
 */
function axisLabels(shape: RenderShape): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const series of shape.series) {
        for (const point of series.points) {
            if (seen.has(point.label)) continue;
            seen.add(point.label);
            order.push(point.label);
        }
    }
    return order;
}

function valueAt(shape: RenderShape, seriesIndex: number, label: string): number | undefined {
    return shape.series[seriesIndex]?.points.find((point) => point.label === label)?.value;
}

/**
 * The visually-hidden table every chart carries.
 *
 * A chart is a claimed fact, and a fact a reader cannot get at is not
 * evidence. The SVG marks are individually labelled and focusable, but a
 * real table is what makes the numbers reachable without navigating marks —
 * the same accessible-data fallback FactRowsPanel already renders beside its
 * charts.
 */
function ShapeDataTable({
    shape,
    labels,
}: {
    readonly shape: RenderShape;
    readonly labels: readonly string[];
}) {
    return (
        <div className="sr-only">
            <table>
                <caption>{shape.title}</caption>
                <thead>
                    <tr>
                        <th scope="col">{shape.axis_label}</th>
                        {shape.series.map((series) => (
                            <th key={series.key} scope="col">
                                {series.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {labels.map((label) => (
                        <tr key={label}>
                            <th scope="row">{label}</th>
                            {shape.series.map((series, seriesIndex) => {
                                const value = valueAt(shape, seriesIndex, label);
                                return (
                                    <td key={series.key}>
                                        {
                                            // An em dash, never a zero: acr
                                            // omits a point for something it
                                            // did not measure, and writing 0
                                            // here would state a measurement
                                            // the answer never made.
                                            value === undefined ? "—" : formatValue(value)
                                        }
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Legend({ shape }: { readonly shape: RenderShape }) {
    if (shape.series.length < 2) return null;
    return (
        <p className="render-shape__legend" data-testid="render-shape-legend">
            {shape.series.map((series, index) => (
                <span className="render-shape__legend-item" key={series.key}>
                    <span
                        className="fact-chart__legend-swatch"
                        style={{ background: `var(${SERIES_VARS[index]!})` }}
                    />
                    {series.label}
                </span>
            ))}
        </p>
    );
}

/**
 * Bars and stacked bars over a category axis.
 *
 * The stacked case draws the segments in the order acr sent them, bottom
 * upward, so the total height IS the score the breakdown explains — acr only
 * selects `stacked_bars` where the parts genuinely compose, and it never
 * trims a stack to the segments that fit.
 */
function CategoryBars({
    shape,
    labels,
}: {
    readonly shape: RenderShape;
    readonly labels: readonly string[];
}) {
    const stacked = shape.presentation === "stacked_bars";
    const singleMax = Math.max(
        0,
        ...shape.series.flatMap((series) => series.points.map((point) => point.value)),
    );
    // The y-scale must fit every drawn column. Summing the present segments
    // is the right thing HERE — it is the height actually drawn — and it is
    // deliberately NOT surfaced as a number anywhere (see the label block
    // below for why a computed sum may not be printed).
    const stackedMax = Math.max(
        0,
        ...labels.map((label) =>
            shape.series.reduce(
                (sum, _series, index) => sum + (valueAt(shape, index, label) ?? 0),
                0,
            ),
        ),
    );
    const maxValue = stacked ? stackedMax : singleMax;
    // A flat all-zero shape still needs a finite scale; 1 keeps every bar at
    // height 0 rather than dividing by zero.
    const scale = maxValue > 0 ? maxValue : 1;
    const band = PLOT_WIDTH / Math.max(labels.length, 1);
    // Capped, not just proportional. A cohort with one ranked team gets one
    // bar, and 60% of a 640px canvas reads as a filled area rather than a
    // bar — the mark stops looking like a measurement. Small-org reality is
    // the normal case here (3-8 teams, often one of them scored), so the
    // one-bar chart is a shape this has to look right in, not an edge case.
    const barWidth = Math.min(band * 0.6, MAX_BAR_WIDTH);
    const shown = labelIndices(labels.length, MAX_AXIS_LABELS);
    const yFor = (value: number) => MARGIN.top + PLOT_HEIGHT - (value / scale) * PLOT_HEIGHT;

    return (
        <svg
            aria-label={`${shape.title}: ${shape.value_label} by ${shape.axis_label}`}
            className="fact-chart__svg"
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            xmlns="http://www.w3.org/2000/svg"
        >
            <title>{shape.title}</title>
            <line
                className="fact-chart__gridline"
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={yFor(0)}
                y2={yFor(0)}
            />
            <text className="fact-chart__axis-label" textAnchor="start" x={0} y={MARGIN.top - 6}>
                <title>{formatValue(maxValue)}</title>
                {formatDisplay(maxValue)}
            </text>
            {labels.map((label, labelIndex) => {
                const centre = MARGIN.left + band * (labelIndex + 0.5);
                let cursor = 0;
                return (
                    <g key={label}>
                        {shape.series.map((series, seriesIndex) => {
                            const value = valueAt(shape, seriesIndex, label);
                            // Missing means unmeasured, so nothing is drawn
                            // and the stack simply does not grow — never a
                            // zero-height segment that would claim the family
                            // was measured and contributed nothing.
                            if (value === undefined) return null;
                            const base = stacked ? cursor : 0;
                            if (stacked) cursor += value;
                            const top = yFor(base + value);
                            const height = Math.abs(yFor(base) - top);
                            const markLabel = `${label}, ${series.label}: ${formatValue(value)} ${shape.value_label}`;
                            return (
                                <g
                                    aria-label={markLabel}
                                    className="fact-chart__mark-group"
                                    key={series.key}
                                    role="img"
                                    tabIndex={0}
                                >
                                    <path
                                        d={roundedTopRectPath(
                                            centre - barWidth / 2,
                                            top,
                                            barWidth,
                                            height,
                                            stacked ? 0 : 4,
                                        )}
                                        fill={`var(${SERIES_VARS[seriesIndex]!})`}
                                    />
                                    <title>{markLabel}</title>
                                </g>
                            );
                        })}
                        {
                            // A single number above the bar, and ONLY for a
                            // single-series shape.
                            //
                            // A stacked bar gets NO total label, and that is
                            // not a style choice. The height of a stack is a
                            // SUM this component computed, and a computed
                            // sum is not a fact: on the live cohort answer,
                            // 0 + 13.333333333333334 + 20 + 13.333333333333334
                            // is 46.66666666666667, while the member's own
                            // score is 46.666666666666664 — a different
                            // number. Printing it would be the exact defect
                            // this whole contract exists to prevent, arrived
                            // at from the renderer's side. The score itself
                            // is already plotted, verbatim and verified, by
                            // the attention-score shape beside it.
                            //
                            // A multi-series UNSTACKED shape gets none
                            // either: reading series 0 and calling it "the
                            // value" silently picks one of several.
                            !stacked && shape.series.length === 1
                                ? (() => {
                                      const only = valueAt(shape, 0, label);
                                      if (only === undefined) return null;
                                      return (
                                          <text
                                              className="fact-chart__value-label"
                                              style={{ opacity: 1 }}
                                              textAnchor="middle"
                                              x={centre}
                                              y={yFor(only) - 5}
                                          >
                                              <title>{formatValue(only)}</title>
                                              {formatDisplay(only)}
                                          </text>
                                      );
                                  })()
                                : null
                        }
                        {shown.has(labelIndex) ? (
                            <text
                                className="fact-chart__axis-label"
                                textAnchor="middle"
                                x={centre}
                                y={HEIGHT - 10}
                            >
                                <title>{label}</title>
                                {axisLabelText(label)}
                            </text>
                        ) : null}
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * One line per series over a time axis.
 *
 * Positioned by ELAPSED TIME, never by index: acr's `dated_fact_trend` rule
 * already proved every label is a real, distinct, same-shaped ISO date, and
 * evenly spacing unevenly-sampled observations would claim a regularity the
 * data does not have.
 */
function TimeLines({
    shape,
    labels,
}: {
    readonly shape: RenderShape;
    readonly labels: readonly string[];
}) {
    const times = labels.map((label) => Date.parse(label));
    const usable = times.every((time) => !Number.isNaN(time));
    const minTime = usable ? Math.min(...times) : 0;
    const span = usable ? Math.max(...times) - minTime || 1 : 1;
    const xFor = (label: string, index: number) =>
        usable
            ? MARGIN.left + ((Date.parse(label) - minTime) / span) * PLOT_WIDTH
            : MARGIN.left + (PLOT_WIDTH / Math.max(labels.length - 1, 1)) * index;

    const values = shape.series.flatMap((series) => series.points.map((point) => point.value));
    const maxValue = Math.max(0, ...values);
    const minValue = Math.min(0, ...values);
    const range = maxValue - minValue || 1;
    const yFor = (value: number) =>
        MARGIN.top + PLOT_HEIGHT - ((value - minValue) / range) * PLOT_HEIGHT;
    const shown = labelIndices(labels.length, MAX_AXIS_LABELS);

    return (
        <svg
            aria-label={`${shape.title}: ${shape.value_label} over ${shape.axis_label}`}
            className="fact-chart__svg"
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            xmlns="http://www.w3.org/2000/svg"
        >
            <title>{shape.title}</title>
            <line
                className="fact-chart__gridline"
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={yFor(minValue)}
                y2={yFor(minValue)}
            />
            <text className="fact-chart__axis-label" textAnchor="start" x={0} y={MARGIN.top - 6}>
                <title>{formatValue(maxValue)}</title>
                {formatDisplay(maxValue)}
            </text>
            {shape.series.map((series, seriesIndex) => {
                const points = labels
                    .map((label, index) => {
                        const value = valueAt(shape, seriesIndex, label);
                        return value === undefined
                            ? null
                            : { x: xFor(label, index), y: yFor(value), value, label, index };
                    })
                    .filter((point): point is NonNullable<typeof point> => point !== null);
                // A line never bridges a gap it does not cover: a break in
                // the run of labels ends the polyline instead of drawing
                // continuity the observations do not support.
                const segments: (typeof points)[] = [];
                let current: typeof points = [];
                let previous: number | null = null;
                for (const point of points) {
                    if (previous !== null && point.index !== previous + 1) {
                        if (current.length > 0) segments.push(current);
                        current = [];
                    }
                    current.push(point);
                    previous = point.index;
                }
                if (current.length > 0) segments.push(current);
                const color = `var(${SERIES_VARS[seriesIndex]!})`;
                return (
                    <g key={series.key}>
                        {segments.map((segment, segmentIndex) => (
                            <polyline
                                fill="none"
                                key={segmentIndex}
                                points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                                stroke={color}
                                strokeWidth={2}
                            />
                        ))}
                        {points.map((point) => {
                            const markLabel = `${point.label}, ${series.label}: ${formatValue(point.value)} ${shape.value_label}`;
                            return (
                                <g
                                    aria-label={markLabel}
                                    className="fact-chart__mark-group"
                                    key={point.label}
                                    role="img"
                                    tabIndex={0}
                                >
                                    <circle cx={point.x} cy={point.y} fill={color} r={4} />
                                    <text
                                        className="fact-chart__value-label"
                                        textAnchor="middle"
                                        x={point.x}
                                        y={point.y - 8}
                                    >
                                        <title>{formatValue(point.value)}</title>
                                        {formatDisplay(point.value)}
                                    </text>
                                    <title>{markLabel}</title>
                                </g>
                            );
                        })}
                    </g>
                );
            })}
            {labels.map((label, index) =>
                shown.has(index) ? (
                    <text
                        className="fact-chart__axis-label"
                        key={label}
                        textAnchor="middle"
                        x={xFor(label, index)}
                        y={HEIGHT - 10}
                    >
                        <title>{label}</title>
                        {axisLabelText(label)}
                    </text>
                ) : null,
            )}
        </svg>
    );
}

/**
 * One render shape acr selected, drawn.
 *
 * Hand-rolled inline SVG, no charting library — the same choice FactChart
 * made, for the same reason (README: minimal dependencies).
 *
 * This component NEVER decides whether a chart is warranted and never
 * computes a value. acr chose the shape from the interpreted intent and
 * copied every number verbatim out of the answer's own cohort and claimed
 * facts; `verifyRenderShape` has already re-resolved each one before this
 * renders. What is left here is purely how to draw it: `kind` says how to
 * read the payload, `presentation` says how to encode it.
 *
 * A kind with no producer yet (quadrant, treemap, sunburst, sankey,
 * burndown, forecast) renders NOTHING rather than a wrong picture — acr
 * cannot emit one today, and inventing a fallback drawing for a payload this
 * component has never seen is how a chart starts claiming something the
 * answer does not.
 */
export function RenderShapeChart({ shape }: RenderShapeChartProps) {
    if (shape.kind !== "series") return null;
    const labels = axisLabels(shape);
    if (labels.length === 0) return null;
    return (
        <figure className="render-shape">
            <figcaption className="render-shape__title">{shape.title}</figcaption>
            <Legend shape={shape} />
            {shape.presentation === "line" ? (
                <TimeLines labels={labels} shape={shape} />
            ) : (
                <CategoryBars labels={labels} shape={shape} />
            )}
            <ShapeDataTable labels={labels} shape={shape} />
        </figure>
    );
}
