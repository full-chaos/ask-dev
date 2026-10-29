import { describe, expect, it } from "vitest";
import { comparePins } from "./check-pin-equality.mjs";

const C = "a".repeat(40);
const D = "b".repeat(40);
const h = (n) => String(n).repeat(64).slice(0, 64);
const ask = {
    source_commit: C,
    files: [
        { path: "examples/x.json", sha256: h(1) },
        { path: "schemas/common.json", sha256: h(2) },
        { path: "schemas/result.v2.json", sha256: h(3) },
    ],
};
const web = {
    source_commit: C,
    files: [
        { path: "schemas/common.json", sha256: h(2) },
        { path: "schemas/result.v2.json", sha256: h(3) },
        { path: "schemas/other.json", sha256: h(4) },
    ],
};

describe("comparePins", () => {
    it("passes on same commit and equal schema digests (examples ignored)", () => {
        expect(comparePins(ask, web)).toEqual([]);
    });
    it("fails on a different source_commit", () => {
        const out = comparePins(ask, { ...web, source_commit: D });
        expect(out.join("\n")).toContain("source_commit differs");
    });
    it("fails on a drifted schema digest", () => {
        const drifted = {
            ...web,
            files: [{ path: "schemas/common.json", sha256: h(9) }, web.files[1]],
        };
        expect(comparePins(ask, drifted).join("\n")).toContain(
            "digest differs for schemas/common.json",
        );
    });
    it("fails when web lacks a schema ask-dev vendors", () => {
        expect(comparePins(ask, { ...web, files: [web.files[0]] }).join("\n")).toContain(
            "web does not vendor schemas/result.v2.json",
        );
    });
    it("fails closed when nothing could be compared", () => {
        expect(comparePins({ source_commit: C, files: [] }, web).join("\n")).toContain(
            "nothing compared",
        );
        expect(comparePins({ files: [] }, web).join("\n")).toContain("not a 40-hex commit");
    });
    it("fails on duplicate paths with conflicting digests in either manifest", () => {
        const dupWeb = {
            ...web,
            files: [...web.files, { path: "schemas/common.json", sha256: h(8) }],
        };
        expect(comparePins(ask, dupWeb).join("\n")).toContain(
            "web manifest lists schemas/common.json twice",
        );
        const dupAsk = {
            ...ask,
            files: [...ask.files, { path: "schemas/common.json", sha256: h(8) }],
        };
        expect(comparePins(dupAsk, web).join("\n")).toContain(
            "ask-dev manifest lists schemas/common.json twice",
        );
    });
    it("fails on malformed manifests: bad commit, missing or non-hex digest, no path, no files", () => {
        const bad = (m) => comparePins(m, web).join("\n");
        expect(bad({ ...ask, source_commit: "not-a-commit" })).toContain("not a 40-hex commit");
        expect(bad({ ...ask, files: [{ path: "schemas/x.json" }] })).toContain("no valid sha256");
        expect(bad({ ...ask, files: [{ path: "schemas/x.json", sha256: "zz" }] })).toContain(
            "no valid sha256",
        );
        expect(bad({ ...ask, files: [{ sha256: h(1) }] })).toContain("without a path");
        expect(bad({ source_commit: C })).toContain("no files array");
        expect(comparePins(ask, { source_commit: D })).not.toEqual([]);
    });
});
