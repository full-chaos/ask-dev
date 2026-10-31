import type { ModelRefusalReason, NarrowingContinuationAxis } from "@/lib/acr/upstream-vocabulary";

/**
 * The failure vocabulary the Workbench shows a tester.
 *
 * Deliberately narrow and honest. A Workbench whose job is proving answer
 * quality must never dress a failure up as a thin answer — "the graph is not
 * enabled" and "no subject matched" are different facts and read differently.
 */
export const workbenchFailureCodes = [
    /**
     * ACR is reachable, but a dependency behind the investigation (its
     * graph store, model runtime, or its own persistence) is currently
     * unavailable.
     *
     * ACR's own 503/`upstream_unavailable` wire signal is ONE code for all
     * of these -- confirmed live (CHAOS-4333): the exact same code fired
     * both for a genuinely uncomposed graph/model runtime AND for an
     * unrelated Postgres CHECK-constraint violation during result
     * persistence, a failure ACR's own sanitizer deliberately never puts on
     * the wire. Never assert which one in the message; the request id is
     * the only honest handle for that.
     */
    "acr_runtime_unavailable",
    /** ACR rejected our credential. */
    "acr_unauthorized",
    /**
     * ACR's per-call access read refused the call (403 `access_denied`, acr
     * #1798): the user is not a member of the organization, is impersonating,
     * the browser session is not live, or the organization or user is unknown.
     * ACR uses one code for every reason, so the Workbench names none of them.
     * Not a credential fault and not retryable as sent.
     */
    "acr_access_denied",
    /**
     * The credential's repository grant within the organization's live
     * repository inventory is empty (409 `no_repository`, acr #1798). An
     * unsynced repository is outside the inventory until it is synced. Not
     * retryable as sent.
     */
    "acr_no_repository",
    /**
     * ACR refused the investigation before admission because the wait budget
     * left after its access read was below the minimum (503
     * `budget_exhausted`, acr #1798). Nothing ran; it is retryable. Not an
     * outage, so not `acr_runtime_unavailable`.
     */
    "acr_budget_exhausted",
    /**
     * The run's owner canceled it before it finished (409 `canceled`, acr
     * #1793). No answer was stored; not retryable under the same submission.
     */
    "acr_canceled",
    /**
     * ACR refused the investigation because of how the organization's own model
     * is set up (403 `feature_not_enabled` with a documented `details.reason`).
     * Not a credential fault and not a thin answer: no model ran and nothing
     * was stored. `refusalReason` says which setup state refused it.
     */
    "acr_model_refused",
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
     * ACR did not answer within a request's time budget.
     *
     * Distinct from `acr_unreachable` on purpose, but covers TWO different
     * waiting-too-long shapes, not just one: (1) ACR answered with its own
     * 504/408 -- the pipeline definitely RAN, just too slowly -- and (2) the
     * Workbench's own local `AbortSignal.timeout(ACR_TIMEOUT_MS)` fired with
     * no response ever arriving at all, which proves nothing about whether
     * ACR's pipeline ran. Either way, collapsing this into `acr_unreachable`
     * sends whoever is debugging to the network/DNS when the real question is
     * which budget ran out and on which side.
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
    /** The documented `details.reason`, on an `acr_model_refused` failure only. */
    readonly refusalReason?: ModelRefusalReason;
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
    /**
     * CHAOS-5107 (CHAOS-4735's client half): the planned refusal's
     * continuation, present only on a 413 budget refusal that named an
     * axis. `axis`/`family` are ACR-authored closed tokens — structural
     * claims, not generated prose — so they are carried the same way
     * `upstreamCode` is. Turning `axis` into English is this component's
     * job, not ACR's: see `@/lib/acr/narrower-continuation-copy`, the ONLY
     * place in the Workbench that phrases a narrower re-ask (E-6, chris).
     */
    readonly narrowerContinuation?:
        | {
              readonly axis: NarrowingContinuationAxis;
              readonly family?: string;
          }
        | undefined;
    /** Which budget ceiling was exceeded (`items`/`bytes`), when ACR said. */
    readonly overrun?: string | undefined;
    /** The item count the refused answer measured, when ACR said. */
    readonly measuredItems?: number | undefined;
    /** The item ceiling the refused answer exceeded, when ACR said. */
    readonly maxItems?: number | undefined;
};

export class AcrRequestError extends Error {
    override readonly name = "AcrRequestError";
    readonly failure: WorkbenchFailure;

    constructor(failure: WorkbenchFailure) {
        super(failure.message);
        this.failure = failure;
    }
}
