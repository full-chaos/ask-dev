import { investigate } from "@/lib/acr/client";

/**
 * The route's ONLY indirection onto `investigate`. Every real failure exit
 * of `investigate()` wraps into `AcrRequestError` (see client.ts: the
 * contract-validation, signing, fetch, and response-parsing failures each
 * have their own try/catch, and each one throws `AcrRequestError`) — so
 * `route.ts`'s own fallback branch for an UNEXPECTED, non-`AcrRequestError`
 * throw has no test that can reach it through config or `fetch` alone.
 *
 * `acrClient` exists so a test CAN reach it: production code always calls
 * the real `investigate` through this binding and nothing else in this
 * module ever reassigns it, but a test may swap `acrClient.investigate` for
 * a function that throws the one shape `investigate()` itself can never
 * produce, call `POST`, then restore the original. A plain property write,
 * not `vi.mock` — this repo has no module-mocking convention, and this
 * keeps the same shape as the existing tests' `vi.stubEnv`/`vi.spyOn(fetch)`
 * seams: swap the one thing under test, leave everything else real.
 */
export const acrClient = {
    investigate,
};
