import { describe, expect, it } from "vitest";
import { comparePins } from "./check-pin-equality.mjs";

const ask = {
    source_commit: "a".repeat(40),
    files: [
        { path: "examples/x.json", sha256: "e1" },
        { path: "schemas/common.json", sha256: "s1" },
        { path: "schemas/result.v2.json", sha256: "s2" },
    ],
};
const web = {
    source_commit: "a".repeat(40),
    files: [
        { path: "schemas/common.json", sha256: "s1" },
        { path: "schemas/result.v2.json", sha256: "s2" },
        { path: "schemas/other.json", sha256: "s3" },
    ],
};

describe("comparePins", () => {
    it("passes on same commit and equal schema digests (examples ignored)", () => {
        expect(comparePins(ask, web)).toEqual([]);
    });
    it("fails on a different source_commit", () => {
        const out = comparePins(ask, { ...web, source_commit: "b".repeat(40) });
        expect(out.join("\n")).toContain("source_commit differs");
    });
    it("fails on a drifted schema digest", () => {
        const drifted = { ...web, files: [{ path: "schemas/common.json", sha256: "XX" }, web.files[1]] };
        expect(comparePins(ask, drifted).join("\n")).toContain("digest differs for schemas/common.json");
    });
    it("fails when web lacks a schema ask-dev vendors", () => {
        expect(comparePins(ask, { ...web, files: [web.files[0]] }).join("\n")).toContain(
            "web does not vendor schemas/result.v2.json",
        );
    });
    it("fails closed when nothing could be compared", () => {
        expect(comparePins({ source_commit: "a".repeat(40), files: [] }, web).join("\n")).toContain(
            "nothing compared",
        );
        expect(comparePins({ files: [] }, web).join("\n")).toContain("no source_commit");
    });
});
