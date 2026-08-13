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
    /** ACR rejected the request payload. */
    "acr_rejected_request",
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
    /** ACR could not be reached at all. */
    "acr_unreachable",
    /** The server hop is not configured (missing env, unreadable key). */
    "workbench_misconfigured",
] as const;

export type WorkbenchFailureCode = (typeof workbenchFailureCodes)[number];

export type WorkbenchFailure = {
    readonly code: WorkbenchFailureCode;
    /** Shown to the tester. Never contains credentials or key material. */
    readonly message: string;
    /** Upstream HTTP status, when there was one. */
    readonly httpStatus?: number;
    /** ACR's own `error.v1` code, when it sent one. */
    readonly upstreamCode?: string;
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
