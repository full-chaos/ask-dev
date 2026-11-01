import { describe, expect, it } from "vitest";

import { evidenceWindowRange, formatDay } from "./evidence-window";

const START = "2026-10-01T12:00:00Z";
const END = "2026-10-30T12:00:00Z";

/** CHAOS-12421: the one reading of a window, for the rail and the answer's Coverage panel. */
describe("evidenceWindowRange", () => {
    it("reads both bounds as a range, over a relative id and an as_of", () => {
        expect(
            evidenceWindowRange({
                start: START,
                end: END,
                relative_id: "trailing_30d",
                as_of: END,
                provenance: "server_default",
            }),
        ).toBe(`${formatDay(START)} – ${formatDay(END)}`);
    });

    it("reads a relative id over an as_of", () => {
        expect(
            evidenceWindowRange({
                relative_id: "trailing_30d",
                as_of: END,
                provenance: "server_default",
            }),
        ).toBe("trailing 30d");
    });

    it("does not make a range from one bound", () => {
        expect(evidenceWindowRange({ start: START, provenance: "server_default" })).toBeUndefined();
        expect(evidenceWindowRange({ end: END, provenance: "server_default" })).toBeUndefined();
    });

    it("reads nothing as nothing, so the caller says Not reported", () => {
        expect(evidenceWindowRange(undefined)).toBeUndefined();
    });
});

describe("formatDay", () => {
    it("shows a date a reader can read", () => {
        expect(formatDay(END)).toContain("2026");
        expect(formatDay(END)).not.toContain("T12");
    });

    it("shows an unreadable value as it came, never as a guess", () => {
        expect(formatDay("not a date")).toBe("not a date");
    });
});
