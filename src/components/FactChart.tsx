import type { ClaimedFactRow } from "@/lib/contracts";
import { cellValue, type ChartAxis } from "@/lib/fact-rows";
import { humanizeTerm } from "@/lib/presentation";

export type FactChartProps = {
    readonly rows: readonly ClaimedFactRow[];
    readonly axis: ChartAxis;
    readonly seriesColumns: readonly string[];
    readonly chartKind: "line" | "bar";
};

const SINGLE_WIDTH = 640;
const SINGLE_HEIGHT = 220;
const MULTIPLE_WIDTH = 300;
const MULTIPLE_HEIGHT = 170;
const MARGIN = { top: 12, right: 12, bottom: 30, left: 12 };
const MAX_AXIS_LABELS_SINGLE = 8;
// CHAOS-4672: a small-multiple cell is MULTIPLE_WIDTH (300px) wide, margins
// included — 5 evenly-spaced ISO-date labels ("2026-08-02", 10 chars) at
// `.fact-chart__axis-label`'s 10px font left ~69px between label CENTERS,
// which visibly collided on the real rig (two ticks' glyphs overlapping,
// reported as run-together text). 3 ticks roughly doubles that gap; the
// single full-width chart (640px, `MAX_AXIS_LABELS_SINGLE`) was not
// reported as colliding and is untouched.
const MAX_AXIS_LABELS_MULTIPLE = 3;

// Fixed hue order (dataviz skill): series 1 always takes slot 1, never
// reassigned by which columns happen to be present. `seriesColumns` is
// already capped at this length by `selectPresentation` (MAX_CHART_SERIES),
// so no modulo/cycling is needed here — a 9th numeric column never reaches
// this component (it stays in the accompanying table instead).
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

function axisLabel(row: ClaimedFactRow, axis: ChartAxis): string {
    const value = row.fields[axis.column];
    if (value === undefined) return "";
    const cell = cellValue(value);
    return cell === null ? "" : String(cell);
}

function seriesValue(row: ClaimedFactRow, column: string): number | undefined {
    const value = row.fields[column];
    if (value === undefined) return undefined;
    const cell = cellValue(value);
    return typeof cell === "number" ? cell : undefined;
}

function formatValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A rect with the top two corners rounded, square and anchored at the baseline (mark spec). */
function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
    const radius = Math.max(0, Math.min(r, w / 2, h));
    if (radius === 0) return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
    return (
        `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} ` +
        `L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`
    );
}

/** Evenly-spaced label indices, always including the first and last row. */
function labelIndices(count: number, maxLabels: number): Set<number> {
    if (count <= maxLabels) return new Set(Array.from({ length: count }, (_, i) => i));
    const step = (count - 1) / (maxLabels - 1);
    const indices = new Set<number>();
    for (let i = 0; i < maxLabels; i++) indices.add(Math.round(i * step));
    return indices;
}

type Point = {
    readonly x: number;
    readonly y: number;
    readonly value: number;
    readonly row: ClaimedFactRow;
};

/**
 * Splits points into contiguous runs by their original row index. A missing
 * value breaks the run — connecting across it with one polyline would
 * visually claim continuity the data does not have (codex round 1,
 * CHAOS-4355).
 */
function contiguousSegments(indexed: readonly { point: Point; rowIndex: number }[]): Point[][] {
    const segments: Point[][] = [];
    let current: Point[] = [];
    let previousRowIndex: number | null = null;
    for (const { point, rowIndex } of indexed) {
        if (previousRowIndex !== null && rowIndex !== previousRowIndex + 1) {
            if (current.length > 0) segments.push(current);
            current = [];
        }
        current.push(point);
        previousRowIndex = rowIndex;
    }
    if (current.length > 0) segments.push(current);
    return segments;
}

type SeriesChartProps = {
    readonly rows: readonly ClaimedFactRow[];
    readonly axis: ChartAxis;
    readonly column: string;
    readonly chartKind: "line" | "bar";
    readonly color: string;
    readonly width: number;
    readonly height: number;
    readonly maxAxisLabels: number;
    readonly showTitle: boolean;
};

/**
 * One column's own chart, on its OWN linear y-scale. Never shares a y-axis
 * with another series (dataviz skill: never dual-axis — two measures of
 * different scale, e.g. a 0..1 rate beside a 0..100 count, get their own
 * chart, not two lines squashed onto one range).
 */
function SeriesChart({
    rows,
    axis,
    column,
    chartKind,
    color,
    width,
    height,
    maxAxisLabels,
    showTitle,
}: SeriesChartProps) {
    // Time rows are ordered — and, when every axis value parses as a real
    // date, POSITIONED — by actual elapsed time, not lexical string order
    // or row index (codex round 1: index spacing implies evenly-spaced
    // samples even when the real gaps between them are not equal).
    // `fact-rows.ts`'s `isTimeColumn` (codex round 2) already requires
    // EVERY row to carry a valid, same-shaped time value before it ever
    // classifies an axis as `kind: "time"` — `timeIsUsable` should
    // therefore always be true here; it stays as defense in depth (this
    // component never assumes the caller upheld that contract) and falls
    // back to plain index spacing rather than crashing if it somehow did
    // not.
    const rawTimes = axis.kind === "time" ? rows.map((r) => Date.parse(axisLabel(r, axis))) : [];
    const timeIsUsable = axis.kind === "time" && rawTimes.every((t) => !Number.isNaN(t));

    // Sort by parsed time only once every value is a usable date (a row
    // missing the axis cell parses to NaN, which sorts unpredictably) —
    // otherwise keep the rows in the order the service sent them.
    const orderedRows = timeIsUsable
        ? rows
              .map((r, i) => ({ r, t: rawTimes[i] ?? 0 }))
              .sort((a, b) => a.t - b.t)
              .map(({ r }) => r)
        : rows;

    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;

    const values = orderedRows
        .map((r) => seriesValue(r, column))
        .filter((v): v is number => v !== undefined);
    const maxValue = values.length > 0 ? Math.max(0, ...values) : 1;
    const minValue = values.length > 0 ? Math.min(0, ...values) : 0;
    const valueRange = maxValue - minValue || 1;

    const bandWidth = plotWidth / Math.max(orderedRows.length, 1);

    let xForIndex: (index: number) => number;
    if (timeIsUsable) {
        const times = orderedRows.map((r) => Date.parse(axisLabel(r, axis)));
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const timeRange = maxTime - minTime || 1;
        xForIndex = (index) => MARGIN.left + ((times[index]! - minTime) / timeRange) * plotWidth;
    } else {
        xForIndex = (index) => MARGIN.left + bandWidth * (index + 0.5);
    }
    const yForValue = (value: number) =>
        MARGIN.top + plotHeight - ((value - minValue) / valueRange) * plotHeight;

    const shownLabels = labelIndices(orderedRows.length, maxAxisLabels);

    const indexedPoints = orderedRows
        .map((r, index) => {
            const value = seriesValue(r, column);
            return value === undefined
                ? null
                : {
                      point: { x: xForIndex(index), y: yForValue(value), value, row: r },
                      rowIndex: index,
                  };
        })
        .filter((p): p is { point: Point; rowIndex: number } => p !== null);
    const points = indexedPoints.map((p) => p.point);
    const segments = contiguousSegments(indexedPoints);

    const axisDescription = `${humanizeTerm(column)} by ${humanizeTerm(axis.column)}`;

    return (
        <div className="fact-chart__cell">
            {showTitle ? (
                <p className="fact-chart__cell-title">
                    <span
                        className="fact-chart__legend-swatch"
                        style={{ background: color, display: "inline-block", marginRight: 6 }}
                    />
                    {humanizeTerm(column)}
                </p>
            ) : null}
            <svg
                aria-label={axisDescription}
                className="fact-chart__svg"
                role="img"
                viewBox={`0 0 ${width} ${height}`}
                xmlns="http://www.w3.org/2000/svg"
            >
                <title>{axisDescription}</title>
                <line
                    className="fact-chart__gridline"
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={yForValue(minValue)}
                    y2={yForValue(minValue)}
                />
                {maxValue !== minValue ? (
                    <line
                        className="fact-chart__gridline"
                        x1={MARGIN.left}
                        x2={width - MARGIN.right}
                        y1={yForValue(maxValue)}
                        y2={yForValue(maxValue)}
                    />
                ) : null}
                <text
                    className="fact-chart__axis-label"
                    textAnchor="start"
                    x={0}
                    y={yForValue(maxValue) - 4}
                >
                    {formatValue(maxValue)}
                </text>

                {orderedRows.map((row, index) =>
                    shownLabels.has(index) ? (
                        <text
                            className="fact-chart__axis-label"
                            key={`axis-${index}`}
                            textAnchor="middle"
                            x={xForIndex(index)}
                            y={height - 8}
                        >
                            {axisLabel(row, axis)}
                        </text>
                    ) : null,
                )}

                {chartKind === "bar"
                    ? points.map((p, index) => {
                          const barWidth = bandWidth * 0.6;
                          const x = p.x - barWidth / 2;
                          const y = Math.min(yForValue(0), p.y);
                          const h = Math.abs(yForValue(0) - p.y);
                          const markLabel = `${axisLabel(p.row, axis)}: ${formatValue(p.value)}`;
                          return (
                              <g
                                  aria-label={markLabel}
                                  className="fact-chart__mark-group"
                                  key={index}
                                  role="img"
                                  tabIndex={0}
                              >
                                  <path d={roundedTopRectPath(x, y, barWidth, h, 4)} fill={color} />
                                  <text
                                      className="fact-chart__value-label"
                                      textAnchor="middle"
                                      x={p.x}
                                      y={y - 4}
                                  >
                                      {formatValue(p.value)}
                                  </text>
                                  <title>{markLabel}</title>
                              </g>
                          );
                      })
                    : segments.map((segment, segmentIndex) => (
                          <g key={segmentIndex}>
                              <polyline
                                  fill="none"
                                  points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
                                  stroke={color}
                                  strokeWidth={2}
                              />
                              {segment.map((p, index) => {
                                  const markLabel = `${axisLabel(p.row, axis)}: ${formatValue(p.value)}`;
                                  return (
                                      <g
                                          aria-label={markLabel}
                                          className="fact-chart__mark-group"
                                          key={index}
                                          role="img"
                                          tabIndex={0}
                                      >
                                          <circle cx={p.x} cy={p.y} fill={color} r={4} />
                                          <text
                                              className="fact-chart__value-label"
                                              textAnchor="middle"
                                              x={p.x}
                                              y={p.y - 8}
                                          >
                                              {formatValue(p.value)}
                                          </text>
                                          <title>{markLabel}</title>
                                      </g>
                                  );
                              })}
                          </g>
                      ))}
            </svg>
        </div>
    );
}

/**
 * A claimed fact's `rows` as a line (time axis) or bar (ordinal axis) chart
 * (CHAOS-4355). Hand-rolled inline SVG, not a charting library — this
 * surface is meant to port into Ask Dev with minimal dependencies (README).
 *
 * A SINGLE numeric column renders as one full-width chart. TWO OR MORE
 * render as small multiples — one mini-chart per column, each on its OWN
 * y-scale — never one shared axis: two measures of different magnitude
 * (e.g. a 0..1 rate beside a 0..100 count) squashed onto a single range is
 * the #1 dataviz anti-pattern (dataviz skill, "never dual-axis"). A missing
 * value for a row is skipped, never interpolated or shown as zero, and a
 * line never connects across a gap it does not cover (see
 * `contiguousSegments`).
 *
 * Every chart is a `role="img"` with an `aria-label`/`<title>` describing
 * it, and every mark carries its own `aria-label` + `<title>` + a
 * keyboard-focusable, visibly-outlined hit area — `FactRowsPanel` also
 * renders a visually-hidden full data table alongside every chart so the
 * underlying numbers are never SVG-only (codex round 1, CHAOS-4355).
 */
export function FactChart({ rows, axis, seriesColumns, chartKind }: FactChartProps) {
    if (seriesColumns.length <= 1) {
        const column = seriesColumns[0];
        if (column === undefined) return null;
        return (
            <div className="fact-chart">
                <SeriesChart
                    axis={axis}
                    chartKind={chartKind}
                    color="var(--series-1)"
                    height={SINGLE_HEIGHT}
                    maxAxisLabels={MAX_AXIS_LABELS_SINGLE}
                    rows={rows}
                    showTitle={false}
                    width={SINGLE_WIDTH}
                    column={column}
                />
            </div>
        );
    }

    return (
        <div className="fact-chart fact-chart--grid">
            {seriesColumns.map((column, seriesIndex) => (
                <SeriesChart
                    axis={axis}
                    chartKind={chartKind}
                    color={`var(${SERIES_VARS[seriesIndex]!})`}
                    height={MULTIPLE_HEIGHT}
                    key={column}
                    maxAxisLabels={MAX_AXIS_LABELS_MULTIPLE}
                    rows={rows}
                    showTitle
                    width={MULTIPLE_WIDTH}
                    column={column}
                />
            ))}
        </div>
    );
}
