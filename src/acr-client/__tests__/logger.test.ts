import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, setAcrLogger } from "../logger";

// CHAOS-12593: the client's error line reaches a host sink that has `error`, and one that has only
// `info` and `warn` (a sink written before the line existed) still gets it, at `warn`.

afterEach(() => {
    setAcrLogger({ info: () => undefined, warn: () => undefined });
});

describe("logger.error", () => {
    it("reaches the host sink's error", () => {
        const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        setAcrLogger(sink);
        logger.error({ seq: 2 }, "refused");
        expect(sink.error).toHaveBeenCalledWith({ seq: 2 }, "refused");
        expect(sink.warn).not.toHaveBeenCalled();
    });

    it("falls back to warn for a sink with no error", () => {
        const sink = { info: vi.fn(), warn: vi.fn() };
        setAcrLogger(sink);
        logger.error({ seq: 2 }, "refused");
        expect(sink.warn).toHaveBeenCalledWith({ seq: 2 }, "refused");
    });
});
