/**
 * The failure vocabulary the Workbench shows a tester.
 *
 * Deliberately narrow and honest. A Workbench whose job is proving answer
 * quality must never dress a failure up as a thin answer — "the graph is not
 * enabled" and "no subject matched" are different facts and read differently.
 */
export const workbenchFailureCodes = [
    /** ACR is reachable but the investigation runtime is not composed. */
    "acr_runtime_unavailable",
    /** ACR rejected our credential. */
    "acr_unauthorized",
    /**
     * ACR is rate limiting the Workbench.
     *
     * Its own class, not folded into `acr_unreachable`: a measurement
     * instrument that misfiles the failure class corrupts the measurement.
     * "Back off and retry later" and "the service could not be reached" lead to
     * completely different conclusions about a run.
     */
    "acr_rate_limited",
    /** ACR rejected the request payload. */
    "acr_rejected_request",
    /**
     * ACR's own validator rejected the answer it derived.
     *
     * A legitimate, classified NON-ANSWER outcome (422 `interpretation_rejected`
     * / `synthesis_rejected`), not a malformed request and not a fault: value
     * level closure refusing a claim it cannot bind to canonical facts is the
     * engine working correctly. Rendering it as "your question was bad" would
     * misattribute the outcome to the tester.
     */
    "acr_answer_rejected",
    /** ACR answered, but the payload does not satisfy its own contract. */
    "acr_contract_violation",
    /**
     * ACR accepted the investigation but did not finish it in time.
     *
     * Distinct from `acr_unreachable` on purpose: the pipeline RAN. Collapsing
     * the two sends whoever is debugging to the network when the real question
     * is which stage was too slow.
     */
    "acr_timeout",
    /**
     * ACR ran the investigation and it failed inside the engine.
     *
     * Also distinct from `acr_unreachable`: the service answered, so the
     * question is which stage broke, not whether the network is up. ACR
     * deliberately does not put the underlying reason on the wire, so the
     * request_id is the handle for matching it in ACR's own logs — which is
     * why the Workbench surfaces that id rather than a guess.
     */
    "acr_investigation_failed",
    /** ACR could not be reached at all. */
    "acr_unreachable",
    /** The server hop is not configured (missing env, unreadable key). */
    "workbench_misconfigured",
] as const;

export type WorkbenchFailureCode = (typeof workbenchFailureCodes)[number];

export type WorkbenchFailure = {
    readonly code: WorkbenchFailureCode;
    /**
     * Shown to the tester. **Always Workbench-authored.**
     *
     * Never ACR's `error.message`, and therefore never any text that could have
     * originated with a model or provider. The Workbench classifies a failure
     * and writes its own sentence; upstream free text is not rendered, not
     * logged, and not carried. `upstreamCode` and `upstreamRequestId` are kept
     * because both are ACR-authored constants, not generated prose.
     */
    readonly message: string;
    /** Upstream HTTP status, when there was one. */
    readonly httpStatus?: number;
    /** ACR's own `error.v1` code, when it sent one. */
    readonly upstreamCode?: string;
    /**
     * ACR's own request id.
     *
     * ACR keeps the underlying reason for an engine failure off the wire, so
     * this id is the ONLY handle for matching a failure to ACR's logs. Showing
     * it turns "it broke" into something an operator can actually look up.
     */
    readonly upstreamRequestId?: string;
    /** Contract validation errors, when the payload failed validation. */
    readonly details?: readonly string[];
    readonly retryable: boolean;
};

export class AcrRequestError extends Error {
    override readonly name = "AcrRequestError";
    readonly failure: WorkbenchFailure;

    constructor(failure: WorkbenchFailure) {
        super(failure.message);
        this.failure = failure;
    }
}
