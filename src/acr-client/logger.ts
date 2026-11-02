/**
 * The ACR browser client's log sink. The client writes content-free lines (see `auth.ts` and
 * `transport.ts`), and a host sends them where its logs go. With no host sink the lines go nowhere:
 * a line is never a reason for the client to fail.
 */
export type AcrLogFields = Readonly<Record<string, unknown>>;

export type AcrLogger = {
    readonly info: (fields: AcrLogFields, message: string) => void;
    readonly warn: (fields: AcrLogFields, message: string) => void;
    /** Optional: a sink written before the client's error line gets it at `warn` (CHAOS-12593). */
    readonly error?: (fields: AcrLogFields, message: string) => void;
};

const SILENT: AcrLogger = { info: () => undefined, warn: () => undefined };

let sink: AcrLogger = SILENT;

/** Sets the host's sink. */
export function setAcrLogger(next: AcrLogger): void {
    sink = next;
}

/** A line is never a reason for the client to fail: a sink that throws loses the line only. */
function safely(write: () => void): void {
    try {
        write();
    } catch {
        // The host's sink failed; the client's own outcome stands (CHAOS-12593, codex r2 P2).
    }
}

export const logger: Required<AcrLogger> = {
    info: (fields, message) => safely(() => sink.info(fields, message)),
    warn: (fields, message) => safely(() => sink.warn(fields, message)),
    error: (fields, message) =>
        safely(() =>
            sink.error === undefined ? sink.warn(fields, message) : sink.error(fields, message),
        ),
};
