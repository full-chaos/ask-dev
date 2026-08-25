/**
 * The only sink this repo has today (CHAOS-4171).
 *
 * Neither this event nor `OutcomeEvent` (`@/lib/telemetry/outcome`) has a
 * real analytics backend to send to yet — this Workbench is platform/test
 * scoped, and no such backend exists in this repo or its env config.
 *
 * SERVER-SIDE ONLY (team-lead ruling, 2026-08-24): a `console.info` called
 * from a client component lands in that one viewer's own browser devtools
 * and nowhere else — in prod nobody collects it, so it would be unemitted
 * telemetry with extra steps. Every call site is a server route (`runtime =
 * "nodejs"`), where stdout IS the collected log surface (SigNoz/log
 * pipeline). Rather than leave a content-safe event built and never
 * observed anywhere (which is what `buildOutcomeEvent` still is — a builder
 * with no caller, unlike this one), this writes one structured JSON line
 * per event: content-safe by construction (the event shape is closed-vocab
 * only, see each event's own doc comment), inspectable today, and a
 * one-line swap for a real sink later without touching any call site — the
 * event SHAPE does not change, only where it goes.
 */
export function emitTelemetryEvent(event: { readonly event: string }): void {
    console.info(JSON.stringify(event));
}
