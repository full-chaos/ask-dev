import { describe, expect, it } from "vitest";

import { evidenceWindowRange, formatWindowDay } from "./evidence-window";

const START = "2026-10-01T12:00:00Z";
const END = "2026-10-30T12:00:00Z";

/** CHAOS-12421: the one reading of a window, for the rail and the answer's Coverage panel. */
describe("evidenceWindowRange", () => {
    it("reads both bounds as a range, over a relative id and an as_of", () => {
        expect(
            evidenceWindowRange(
                {
                    start: START,
                    end: END,
                    relative_id: "trailing_30d",
                    as_of: END,
                    provenance: "server_default",
                },
                undefined,
            ),
        ).toBe(`${formatWindowDay(START)} – ${formatWindowDay(END)}`);
    });

    it("reads a relative id over an as_of", () => {
        expect(
            evidenceWindowRange(
                {
                    relative_id: "trailing_30d",
                    as_of: END,
                    provenance: "server_default",
                },
                undefined,
            ),
        ).toBe("trailing 30d");
    });

    it("does not make a range from one bound", () => {
        expect(
            evidenceWindowRange({ start: START, provenance: "server_default" }, undefined),
        ).toBeUndefined();
        expect(
            evidenceWindowRange({ end: END, provenance: "server_default" }, undefined),
        ).toBeUndefined();
    });

    it("reads nothing as nothing, so the caller says Not reported", () => {
        expect(evidenceWindowRange(undefined, undefined)).toBeUndefined();
    });
});

describe("formatDay", () => {
    it("shows a date a reader can read", () => {
        expect(formatWindowDay(END)).toContain("2026");
        expect(formatWindowDay(END)).not.toContain("T12");
    });

    it("shows an unreadable value as it came, never as a guess", () => {
        expect(formatWindowDay("not a date")).toBe("not a date");
    });
});

/** CHAOS-13005: a window of UTC midnights is the served days in every reader's zone. */
describe("a window reads in UTC, not in the reader's zone", () => {
    const WINDOW = {
        start: "2026-08-06T00:00:00Z",
        end: "2026-11-04T00:00:00Z",
        relative_id: "trailing_90d",
        provenance: "inferred_default",
    } as const;
    const utc = (iso: string) =>
        new Date(iso).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });

    it.each(["America/Los_Angeles", "Pacific/Auckland", "UTC"])("in %s", (zone) => {
        const before = process.env.TZ;
        process.env.TZ = zone;
        try {
            expect(evidenceWindowRange(WINDOW, undefined)).toBe(
                `${utc(WINDOW.start)} – ${utc("2026-11-03T00:00:00Z")}`,
            );
            expect(evidenceWindowRange(WINDOW, undefined)).toContain(" 6, 2026");
            expect(evidenceWindowRange(WINDOW, undefined)).toContain(" 3, 2026");
        } finally {
            if (before === undefined) delete process.env.TZ;
            else process.env.TZ = before;
        }
    });

    it("shows the last covered day for an end-exclusive midnight, and an end that is not midnight as its own day", () => {
        expect(evidenceWindowRange(WINDOW, undefined)).toBe(
            `${utc(WINDOW.start)} – ${utc("2026-11-03T00:00:00Z")}`,
        );
        expect(evidenceWindowRange({ ...WINDOW, end: "2026-11-04T12:00:00Z" }, undefined)).toBe(
            `${utc(WINDOW.start)} – ${utc("2026-11-04T12:00:00Z")}`,
        );
    });
});
