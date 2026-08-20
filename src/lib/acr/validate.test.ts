import { describe, expect, it } from "vitest";

import { isDateTimeFormatted } from "@/lib/acr/validate";

/**
 * codex review round 2: an earlier version of the conversation-turn
 * `created_at` guard used `Date.parse`, which is looser than the pinned
 * contract's own `format: "date-time"` (RFC 3339) — it accepts values the
 * schema rejects. `isDateTimeFormatted` runs the SAME ajv-formats check
 * `validateContract` uses everywhere else, so these cases are exactly what
 * distinguishes it from the loose check it replaced.
 */
describe("isDateTimeFormatted", () => {
    it("accepts what the client itself produces (new Date().toISOString())", () => {
        expect(isDateTimeFormatted(new Date("2026-01-01T00:00:00.000Z").toISOString())).toBe(true);
    });

    it("accepts an RFC 3339 date-time with a non-UTC numeric offset", () => {
        expect(isDateTimeFormatted("2026-01-01T00:00:00+02:00")).toBe(true);
    });

    it("rejects a date-only string — Date.parse would have accepted this", () => {
        expect(isDateTimeFormatted("2026-01-01")).toBe(false);
    });

    it("rejects a timestamp missing its UTC offset — Date.parse would have accepted this", () => {
        expect(isDateTimeFormatted("2026-01-01T00:00:00")).toBe(false);
    });

    it("rejects non-date-shaped garbage", () => {
        expect(isDateTimeFormatted("not-a-timestamp")).toBe(false);
        expect(isDateTimeFormatted("")).toBe(false);
    });
});
