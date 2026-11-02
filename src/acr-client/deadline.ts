/** The browser's bounds on one Ask Dev run (plan 2.7.6). */

/** How long the browser waits on one run, unless ACR's own budget says otherwise. */
export const RUN_TIMEOUT_DEFAULT_MS = 120_000;

/** Headroom ACR keeps back from the budget header (it composes the degraded answer in it). */
export const WAIT_BUDGET_HEADROOM_MS = 5_000;
/** ACR honours no smaller budget (`ContextFabricWaitBudgetMinSeconds`, acr wait_budget.go). */
export const ACR_MIN_WAIT_BUDGET_SECONDS = 10;

/** Longest wait for ACR's response headers (admission). */
export const HEADER_WAIT_MAX_MS = 15_000;

/** No upstream bytes for this long once the stream is open means the run stalled. */
export const STALL_MS = 30_000;
