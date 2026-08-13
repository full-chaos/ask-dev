import type { WorkbenchFailure } from "@/lib/acr/errors";

export type FailurePanelProps = {
    readonly failure: WorkbenchFailure;
};

/**
 * Reports a failure as a failure.
 *
 * The Workbench exists to prove answer quality, so a failure must never be
 * dressed up as a thin answer. This panel names the upstream code and status
 * and, where the cause is an operator state rather than a transient blip, says
 * what has to be true for the call to succeed.
 */
export function FailurePanel({ failure }: FailurePanelProps) {
    return (
        <section className="panel panel--failure" aria-labelledby="failure-title" role="alert">
            <h2 className="panel__title" id="failure-title">
                No answer
            </h2>
            <p className="answer__judgment">{failure.message}</p>
            <p className="record__meta">
                {failure.code}
                {failure.httpStatus === undefined ? "" : ` · HTTP ${failure.httpStatus}`}
                {failure.upstreamCode === undefined ? "" : ` · ${failure.upstreamCode}`}
                {failure.retryable ? " · retryable" : " · not retryable"}
            </p>
            {failure.upstreamRequestId === undefined ? null : (
                <p className="record__meta">
                    ACR request id <code>{failure.upstreamRequestId}</code> — quote this to match
                    the failure against ACR&apos;s own logs.
                </p>
            )}
            {failure.details !== undefined && failure.details.length > 0 ? (
                <ul className="stack stack--tight" style={{ marginTop: 10 }}>
                    {failure.details.map((detail) => (
                        <li className="record" key={detail}>
                            <code>{detail}</code>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
