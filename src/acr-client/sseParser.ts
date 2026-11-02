/**
 * An incremental Server-Sent Events parser for the browser's ACR stream (CHAOS-12104, T14a; ported
 * unchanged from web #1608, which parsed the same stream in a web route that no longer exists).
 * Pure: no secrets, safe to unit test.
 *
 * It follows the WHATWG event-stream rules: a line ends at LF, CRLF or CR (also when the CR and
 * the LF arrive in different chunks); a line that starts with `:` is a comment; `data` lines are
 * joined with LF; a blank line dispatches the event; an event with no `data` line is not
 * dispatched; a leading byte order mark is ignored; and an event still open at the end of the
 * stream is discarded. Lines are split on bytes, which is safe because no UTF-8 sequence contains
 * a CR or LF byte, so a chunk that ends inside a character never breaks it. A line that is not
 * valid UTF-8 is a parse error, not replacement text.
 *
 * One event may hold at most `maxEventBytes` bytes: every line of the frame, comments and the
 * closing blank line included, plus one byte for each line end (LF, CR or CRLF alike; for ACR's
 * LF-only frames that is the exact wire size). The count includes the line still being read, so an
 * endless line fails at the cap and is never held whole.
 */

export type SseEvent = {
    /** The `event` field; `undefined` when the frame has none. */
    readonly event: string | undefined;
    /** The `data` lines, joined with LF. */
    readonly data: string;
    /** The frame's own `id` field; `undefined` when the frame has none. */
    readonly id: string | undefined;
};

export class SseEventTooLargeError extends Error {
    override readonly name = "SseEventTooLargeError";
    constructor(readonly maxEventBytes: number) {
        super(`An event is larger than ${maxEventBytes} bytes.`);
    }
}

export class SseMalformedError extends Error {
    override readonly name = "SseMalformedError";
}

const LF = 0x0a;
const CR = 0x0d;
const BOM = "﻿";

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
    if (parts.length === 1) return parts[0]!;
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }
    return joined;
}

export class SseParser {
    private readonly decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    /** The line being read: its parts, and their size. */
    private line: Uint8Array[] = [];
    private lineBytes = 0;
    /** Bytes of the current event's complete lines, terminators included. */
    private eventBytes = 0;
    /** The previous byte was a CR, so an LF that comes next closes nothing. */
    private afterCr = false;
    private atStreamStart = true;
    private data: string[] = [];
    private eventName: string | undefined;
    private id: string | undefined;
    private failed = false;

    constructor(private readonly maxEventBytes: number) {}

    /** Parses one chunk and returns the events it completed, in order. */
    push(chunk: Uint8Array): SseEvent[] {
        if (this.failed) throw new SseMalformedError("The parser already failed.");
        const out: SseEvent[] = [];
        try {
            let start = 0;
            for (let index = 0; index < chunk.length; index += 1) {
                const byte = chunk[index]!;
                if (this.afterCr) {
                    this.afterCr = false;
                    if (byte === LF) {
                        // The LF of a CRLF whose CR ended the previous line: already counted.
                        start = index + 1;
                        continue;
                    }
                }
                if (byte !== LF && byte !== CR) continue;
                this.append(chunk.subarray(start, index));
                this.endLine(out);
                this.afterCr = byte === CR;
                start = index + 1;
            }
            this.append(chunk.subarray(start));
        } catch (error) {
            this.failed = true;
            throw error;
        }
        return out;
    }

    /**
     * Ends the stream. It returns whether an event was still open (a frame that never got its
     * blank line); that event is discarded, as the event-stream rules require.
     */
    end(): { readonly discardedPartialEvent: boolean } {
        const discardedPartialEvent =
            this.lineBytes > 0 ||
            this.data.length > 0 ||
            this.eventName !== undefined ||
            this.id !== undefined;
        this.line = [];
        this.lineBytes = 0;
        this.resetEvent();
        return { discardedPartialEvent };
    }

    private append(part: Uint8Array): void {
        if (part.length === 0) return;
        this.lineBytes += part.length;
        this.guard();
        this.line.push(part);
    }

    private guard(): void {
        if (this.eventBytes + this.lineBytes > this.maxEventBytes) {
            throw new SseEventTooLargeError(this.maxEventBytes);
        }
    }

    private endLine(out: SseEvent[]): void {
        const bytes = this.lineBytes;
        let text: string;
        try {
            text = this.decoder.decode(concat(this.line, bytes));
        } catch (error) {
            throw new SseMalformedError("A line is not valid UTF-8.", { cause: error });
        }
        this.line = [];
        this.lineBytes = 0;
        // The line and one byte for its end.
        this.eventBytes += bytes + 1;
        this.guard();
        if (this.atStreamStart) {
            this.atStreamStart = false;
            if (text.startsWith(BOM)) text = text.slice(BOM.length);
        }
        if (text === "") {
            if (this.data.length > 0) {
                out.push({ data: this.data.join("\n"), event: this.eventName, id: this.id });
            }
            this.resetEvent();
            return;
        }
        // A comment (`:` first) has an empty field name, so the switch below ignores it.
        const colon = text.indexOf(":");
        const field = colon === -1 ? text : text.slice(0, colon);
        let value = colon === -1 ? "" : text.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        switch (field) {
            case "data":
                this.data.push(value);
                break;
            case "event":
                this.eventName = value;
                break;
            case "id":
                if (!value.includes("\0")) this.id = value;
                break;
            default:
                // `retry` and unknown fields are ignored.
                break;
        }
    }

    private resetEvent(): void {
        this.data = [];
        this.eventName = undefined;
        this.id = undefined;
        this.eventBytes = 0;
    }
}
