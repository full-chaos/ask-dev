import type { ReactNode } from "react";

import { formatDay } from "../../lib/evidence-window";
import { CHAT_STATUS_COPY, CTA_LABELS, EVIDENCE_COPY, NOT_RUN_COPY } from "../../render/chat-copy";
import type { ChatEvidenceDetail, ChatEvidenceState } from "../../render/source";
import { Details } from "../Details";
import { SafeAnswerText } from "../SafeAnswerText";

export type ChatEvidenceBodyProps = {
    readonly state: ChatEvidenceState;
    /** Offered on `unavailable` only. The host decides what a retry reads. */
    readonly onRetry?: (() => void) | undefined;
    /** The host's Connect affordance, shown on `connect` only. */
    readonly connect?: ReactNode;
};

function Detail({ detail }: { readonly detail: ChatEvidenceDetail }) {
    const fields = detail.structuredFields;
    const hasFields = fields !== undefined && Object.keys(fields).length > 0;
    return (
        <>
            <p className="evidence-body__citation">
                <SafeAnswerText text={detail.citation} />
            </p>
            {detail.excerpt === undefined ? null : (
                <p className="evidence-body__excerpt">
                    <SafeAnswerText text={detail.excerpt} />
                </p>
            )}
            {detail.observedAt === undefined ? null : (
                <p className="evidence-body__meta">
                    {EVIDENCE_COPY.observed} {formatDay(detail.observedAt)}
                </p>
            )}
            <Details summary={EVIDENCE_COPY.details}>
                <code>{detail.refId}</code>
                {hasFields ? <pre>{JSON.stringify(fields, null, 2)}</pre> : null}
            </Details>
        </>
    );
}

function Words({ children }: { readonly children: ReactNode }) {
    return <p className="evidence-body__words">{children}</p>;
}

function Inner({ state, onRetry, connect }: ChatEvidenceBodyProps) {
    switch (state.kind) {
        case "loading":
            return (
                <p className="evidence-body__words" role="status">
                    {EVIDENCE_COPY.loading}
                </p>
            );
        case "ready":
            return <Detail detail={state.detail} />;
        case "stale":
            return (
                <>
                    <Words>{EVIDENCE_COPY.stale}</Words>
                    <Detail detail={state.detail} />
                </>
            );
        case "redacted":
            return (
                <>
                    <Words>{EVIDENCE_COPY.redacted}</Words>
                    {state.reason === undefined ? null : (
                        <p className="evidence-body__excerpt">
                            <SafeAnswerText text={state.reason} />
                        </p>
                    )}
                    {state.detail === undefined ? null : <Detail detail={state.detail} />}
                </>
            );
        case "not_found":
            return <Words>{EVIDENCE_COPY.notFound}</Words>;
        case "denied":
            return <Words>{NOT_RUN_COPY.access_denied}</Words>;
        case "no_repository":
            return <Words>{NOT_RUN_COPY.no_repository}</Words>;
        case "unavailable":
            return (
                <>
                    <Words>{EVIDENCE_COPY.unavailable}</Words>
                    {onRetry === undefined ? null : (
                        <button className="question-form__submit" onClick={onRetry} type="button">
                            {CTA_LABELS.tryAgain}
                        </button>
                    )}
                </>
            );
        case "connect":
            return (
                <>
                    <Words>{CHAT_STATUS_COPY.connect}</Words>
                    {connect === undefined || connect === null ? null : (
                        <div className="evidence-body__slot">{connect}</div>
                    )}
                </>
            );
    }
}

/**
 * One opened evidence reference, drawn from a state the host read (CHAOS-12426). It holds no
 * effect, no timer and no fetch: the host reads, and passes the state. Served text (citation,
 * excerpt, reason) shows as served, through `SafeAnswerText`. The raw ref id and structured fields
 * go in a closed fold only. `not_found` shows no id anywhere: it says nothing of whether the
 * evidence exists. The root carries `.ask-dev` because a host mounts this in its own drawer,
 * outside the render's root.
 */
export function ChatEvidenceBody(props: ChatEvidenceBodyProps) {
    return (
        <div className="ask-dev">
            <div
                className="evidence-body"
                data-state={props.state.kind}
                data-testid="ask-dev-evidence-body"
            >
                <Inner {...props} />
            </div>
        </div>
    );
}
