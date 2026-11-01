"use client";

import { useEffect, useState } from "react";

import { CHAT_PROGRESS_COPY, CHAT_STAGE_COPY, formatElapsed } from "../../render/chat-copy";
import { type ChatProgress, stageRows } from "../../render/source";

function phaseWords(phase: ChatProgress["phase"]): string {
    switch (phase) {
        case "queued":
            return CHAT_PROGRESS_COPY.queued;
        case "recovering":
            return CHAT_PROGRESS_COPY.recovering;
        case "observing":
            return CHAT_PROGRESS_COPY.observing;
        case "restoring":
            return CHAT_PROGRESS_COPY.restoring;
        default:
            return CHAT_PROGRESS_COPY.running;
    }
}

/** A run that is canceling says so alone, in the phase's place: see `ChatProgressView`. */
function stopWords(stop: ChatProgress["stop"]): string | undefined {
    switch (stop) {
        case "requested":
            return CHAT_PROGRESS_COPY.stopRequested;
        case "not_leased":
            return CHAT_PROGRESS_COPY.stopNotLeased;
        default:
            return undefined;
    }
}

/**
 * The time since the run began, counted once a second. The timeline is a live region, so the line
 * opts out: a transcript announces additions, not a clock.
 */
function ChatElapsed({ startedAt }: { readonly startedAt: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, []);
    return (
        <p aria-live="off" className="chat__progress-meta chat__elapsed" data-testid="chat-elapsed">
            {CHAT_STAGE_COPY.elapsed}{" "}
            <span data-testid="chat-elapsed-value">{formatElapsed(now - startedAt)}</span>
        </p>
    );
}

/**
 * A pending turn whose source reports progress (CHAOS-12382): its place in a batch, the phase in
 * words, the stage checklist, the elapsed time and, when a Stop was asked for, what became of it.
 * It shows progress only, never answer content: no claim, coverage or score comes before a result
 * (checks 11, 12).
 *
 * The standalone source never reports progress; its pending turn keeps the one-line
 * "Investigating…" markup in `AskDevChat`, unchanged.
 */
export function ChatProgressView({ progress }: { readonly progress: ChatProgress }) {
    const stop = stopWords(progress.stop);
    // Web's rule: a run that is canceling is canceling, whatever its phase was. "Canceling…" stands
    // alone, the clock goes on, and the checklist goes: it follows a run, not its end.
    const canceling = progress.stop === "canceling";
    // Web's rule: running, recovering, observing and canceling count; a restoring turn reads an old
    // answer and a queued one has not begun, so neither has a run to time. A start that is not a
    // time shows nothing, not "NaN:NaN".
    const startedAt =
        progress.startedAt === undefined ? Number.NaN : Date.parse(progress.startedAt);
    const showElapsed =
        !Number.isNaN(startedAt) &&
        ((progress.phase !== "restoring" && progress.phase !== "queued") || canceling);
    // A restored or recovered turn may know no stage. Five "not started" rows would then say
    // something false about a run that did start, so the checklist waits for a running turn or a
    // named stage.
    const showStages =
        !canceling &&
        ((progress.phase ?? "running") === "running" ||
            progress.stage !== undefined ||
            (progress.stages ?? []).length > 0);
    const batch = progress.batch !== undefined && progress.batch.total > 1 ? progress.batch : null;
    return (
        <div className="chat__progress" data-testid="chat-progress">
            {batch === null ? null : (
                <p className="chat__progress-meta" data-testid="chat-progress-batch">
                    {CHAT_PROGRESS_COPY.batchPosition(batch.position, batch.total)}
                </p>
            )}
            <p className="chat__pending" role="status">
                {canceling ? CHAT_PROGRESS_COPY.canceling : phaseWords(progress.phase)}
            </p>
            {showStages ? (
                <ol aria-label={CHAT_STAGE_COPY.steps} className="chat__stages">
                    {stageRows(progress).map(({ stage, state }) => (
                        <li
                            aria-current={state === "active" ? "step" : undefined}
                            className={`chat__stage chat__stage--${state}`}
                            data-stage={stage}
                            data-state={state}
                            key={stage}
                        >
                            <span aria-hidden="true" className="chat__stage-mark" />
                            <span className="chat__stage-label">
                                {CHAT_STAGE_COPY.stages[stage]}
                            </span>
                            <span className="sr-only">: {CHAT_STAGE_COPY.state[state]}</span>
                        </li>
                    ))}
                </ol>
            ) : null}
            {showElapsed ? <ChatElapsed startedAt={startedAt} /> : null}
            {stop === undefined ? null : (
                <p className="chat__progress-meta" data-testid="chat-progress-stop">
                    {stop}
                </p>
            )}
        </div>
    );
}
