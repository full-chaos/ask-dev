import { investigate } from "@/lib/acr/client";

/**
 * The route's ONLY indirection onto `investigate`. `investigate()` wraps
 * MOST of its own failure exits into `AcrRequestError` — contract
 * validation, signing, the `fetch` call itself, and JSON/contract
 * validation of the response body each have their own try/catch throwing
 * `AcrRequestError` — but not all of them: `client.ts`'s `await
 * response.text()` sits OUTSIDE any try/catch, so a body-stream read
 * failure reaches `route.ts` as a raw, unwrapped throw already (see
 * `route.test.ts`'s "response.text() rejecting" case). `route.ts`'s
 * fallback branch for an unexpected, non-`AcrRequestError` throw is
 * therefore reachable in production; what it lacked was a DETERMINISTIC
 * way to drive that branch in a test without depending on a fragile
 * streaming-body failure simulation, and coverage for shapes other than
 * that one specific unwrapped call.
 *
 * `acrClient` is that deterministic seam: production code always calls the
 * real `investigate` through this binding and nothing else in this module
 * ever reassigns it, but a test may swap `acrClient.investigate` for a
 * function that throws directly, call `POST`, then restore the original. A
 * plain property write, not `vi.mock` — this repo has no module-mocking
 * convention, and this keeps the same shape as the existing tests'
 * `vi.stubEnv`/`vi.spyOn(fetch)` seams: swap the one thing under test,
 * leave everything else real.
 */
export const acrClient = {
    investigate,
};
