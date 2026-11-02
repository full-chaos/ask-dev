import { describe, expect, it } from "vitest";

import { SseEventTooLargeError, SseMalformedError, SseParser, type SseEvent } from "../sseParser";
import { MAX_EVENT_BYTES } from "../limits";
import { CAPTURED_EVENTS, STREAM_CAPTURE } from "./eventFixtures";

const encoder = new TextEncoder();
const CAPTURE_BYTES = encoder.encode(STREAM_CAPTURE);

function parseChunks(chunks: readonly Uint8Array[], max = MAX_EVENT_BYTES): SseEvent[] {
    const parser = new SseParser(max);
    const events = chunks.flatMap((chunk) => parser.push(chunk));
    expect(parser.end().discardedPartialEvent).toBe(false);
    return events;
}

function parseText(...chunks: string[]): SseEvent[] {
    return parseChunks(chunks.map((chunk) => encoder.encode(chunk)));
}

describe("SseParser on the real ACR capture", () => {
    const whole = parseChunks([CAPTURE_BYTES]);

    it("reads every frame ACR wrote, in order, with its event, id and data", () => {
        expect(whole.map((event) => event.event)).toEqual(CAPTURED_EVENTS.map((e) => e.type));
        expect(whole.map((event) => event.id)).toEqual(CAPTURED_EVENTS.map((e) => String(e.seq)));
        expect(whole.map((event) => JSON.parse(event.data) as unknown)).toEqual(CAPTURED_EVENTS);
    });

    it("gives the same events one byte at a time", () => {
        const bytes = [...CAPTURE_BYTES].map((byte) => Uint8Array.of(byte));
        expect(parseChunks(bytes)).toEqual(whole);
    });

    it("gives the same events for a split at every offset of the first frames, and every 97th offset after", () => {
        const offsets: number[] = [];
        for (let offset = 1; offset < 1_200; offset += 1) offsets.push(offset);
        for (let offset = 1_200; offset < CAPTURE_BYTES.length; offset += 97) offsets.push(offset);
        for (const offset of offsets) {
            const events = parseChunks([
                CAPTURE_BYTES.subarray(0, offset),
                CAPTURE_BYTES.subarray(offset),
            ]);
            expect(events, `split at ${offset}`).toEqual(whole);
        }
    });
});

describe("SseParser line rules", () => {
    it("joins multi-line data with LF and strips one leading space only", () => {
        expect(parseText("data: one\ndata:two\ndata:  three\ndata\n\n")).toEqual([
            { data: "one\ntwo\n three\n", event: undefined, id: undefined },
        ]);
    });

    it("ends lines at CRLF and CR, also when the CR and the LF arrive in different chunks", () => {
        expect(parseText("event: stage\r\ndata: a\r\r\n")).toEqual([
            { data: "a", event: "stage", id: undefined },
        ]);
        // A CRLF split across chunks is one line end: the LF must not become a blank line that
        // dispatches `a` alone.
        expect(parseText("data: a\r", "\ndata: b\r", "\n\r", "\n")).toEqual([
            { data: "a\nb", event: undefined, id: undefined },
        ]);
    });

    it("skips comments and does not dispatch an event with no data line", () => {
        expect(parseText(": keepalive\n\nevent: stage\nid: 4\n\n: x\ndata: y\n\n")).toEqual([
            { data: "y", event: undefined, id: undefined },
        ]);
    });

    it("keeps a multi-byte character split across chunks whole", () => {
        const bytes = encoder.encode("data: résumé — ok\n\n");
        const split = bytes.indexOf(0xc3) + 1;
        expect(parseChunks([bytes.subarray(0, split), bytes.subarray(split)])).toEqual([
            { data: "résumé — ok", event: undefined, id: undefined },
        ]);
    });

    it("ignores a leading byte order mark", () => {
        expect(parseText("﻿id: 1\ndata: x\n\n")).toEqual([
            { data: "x", event: undefined, id: "1" },
        ]);
    });

    it("refuses a line that is not UTF-8, and every chunk after it", () => {
        const parser = new SseParser(MAX_EVENT_BYTES);
        expect(() => parser.push(Uint8Array.of(0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0x0a))).toThrow(
            SseMalformedError,
        );
        expect(() => parser.push(encoder.encode("data: x\n\n"))).toThrow(SseMalformedError);
    });

    it("discards an event the stream ended inside, and says so", () => {
        const parser = new SseParser(MAX_EVENT_BYTES);
        expect(parser.push(encoder.encode("data: complete\n\nevent: result\ndata: {"))).toEqual([
            { data: "complete", event: undefined, id: undefined },
        ]);
        expect(parser.end()).toEqual({ discardedPartialEvent: true });
    });

    it.each([
        ["a line with no end", "data: {"],
        ["a data line with no blank line", "data: x\n"],
        ["only an event field", "event: result\n"],
        ["only an id field", "id: 3\n"],
    ])("reports %s at the end as a discarded event", (_name, text) => {
        const parser = new SseParser(MAX_EVENT_BYTES);
        expect(parser.push(encoder.encode(text))).toEqual([]);
        expect(parser.end()).toEqual({ discardedPartialEvent: true });
    });

    it("reports a clean end after a complete event or a comment", () => {
        for (const text of ["data: x\n\n", ": keepalive\n\n", ""]) {
            const parser = new SseParser(MAX_EVENT_BYTES);
            parser.push(encoder.encode(text));
            expect(parser.end(), text).toEqual({ discardedPartialEvent: false });
        }
    });
});

describe("SseParser event cap", () => {
    // "data: abc\n\n" is 11 bytes on the wire: the line, its LF, and the blank line's LF.
    it("passes an event of exactly the cap and refuses one byte more", () => {
        expect(parseChunks([encoder.encode("data: abc\n\n")], 11)).toHaveLength(1);
        expect(() => new SseParser(10).push(encoder.encode("data: abc\n\n"))).toThrow(
            SseEventTooLargeError,
        );
    });

    it("counts each event on its own, comments included, one byte per line end", () => {
        // Two 11-byte events under an 11-byte cap: the count restarts at each blank line.
        expect(parseChunks([encoder.encode("data: abc\n\ndata: def\n\n")], 11)).toHaveLength(2);
        // A comment counts, and a CRLF counts one byte like an LF: 4 + 8 + 1 = 13.
        expect(parseChunks([encoder.encode(": k\r\ndata: a\r\n\r\n")], 13)).toHaveLength(1);
        expect(() => new SseParser(12).push(encoder.encode(": k\r\ndata: a\r\n\r\n"))).toThrow(
            SseEventTooLargeError,
        );
    });

    it("refuses an endless line at the cap, before it ends, across chunks", () => {
        const parser = new SseParser(1_024);
        parser.push(encoder.encode("data: "));
        expect(() => parser.push(new Uint8Array(1_024).fill(0x61))).toThrow(SseEventTooLargeError);
    });

    it("refuses a frame of many short data lines over the cap", () => {
        const lines = "data: x\n".repeat(200);
        expect(() => new SseParser(1_024).push(encoder.encode(lines))).toThrow(
            SseEventTooLargeError,
        );
    });

    it("holds the real capture's largest frame under the product cap", () => {
        const largest = Math.max(...STREAM_CAPTURE.split("\n\n").map((f) => f.length + 2));
        expect(largest).toBeLessThan(MAX_EVENT_BYTES);
        expect(parseChunks([CAPTURE_BYTES], largest)).toHaveLength(CAPTURED_EVENTS.length);
        expect(() => new SseParser(largest - 1).push(CAPTURE_BYTES)).toThrow(SseEventTooLargeError);
    });
});
