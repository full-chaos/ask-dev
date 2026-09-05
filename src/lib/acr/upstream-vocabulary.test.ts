import { describe, expect, it } from "vitest";

import { boundedNonNegativeInteger } from "@/lib/acr/upstream-vocabulary";

/**
 * codex review round 1 (CHAOS-5107 lane), P2: `Number.isInteger`/`>= 0`
 * alone accepted two shapes that should never render as "a count" —
 * verified directly against the exported function here rather than through
 * a JSON round-trip, since `JSON.stringify(-0)` normalizes to the text
 * `"0"` and can never reproduce a real `-0` value through that path (the
 * wire-level case, a literal `-0` in the response body text, is exactly as
 * real: `JSON.parse("-0")` does yield a genuine negative zero).
 */
describe("boundedNonNegativeInteger", () => {
    it("accepts an ordinary non-negative integer", () => {
        expect(boundedNonNegativeInteger(0)).toBe(0);
        expect(boundedNonNegativeInteger(42)).toBe(42);
    });

    it("rejects negative zero", () => {
        expect(boundedNonNegativeInteger(-0)).toBeUndefined();
    });

    it("rejects a value beyond Number.MAX_SAFE_INTEGER", () => {
        expect(boundedNonNegativeInteger(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
        expect(boundedNonNegativeInteger(Number.MAX_SAFE_INTEGER + 2)).toBeUndefined();
    });

    it("rejects non-numbers, negatives, non-integers, NaN, and Infinity", () => {
        expect(boundedNonNegativeInteger("42")).toBeUndefined();
        expect(boundedNonNegativeInteger(-1)).toBeUndefined();
        expect(boundedNonNegativeInteger(1.5)).toBeUndefined();
        expect(boundedNonNegativeInteger(Number.NaN)).toBeUndefined();
        expect(boundedNonNegativeInteger(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(boundedNonNegativeInteger(undefined)).toBeUndefined();
    });
});
