import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "check-pin-equality.mjs");
const ownManifestPath = path.join(here, "../src/contracts/manifest.json");
const own = JSON.parse(fs.readFileSync(ownManifestPath, "utf8"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-eq-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(name, value) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
}
function run(entry, args) {
    return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
}

describe("check-pin-equality CLI", () => {
    const tampered = {
        ...own,
        files: own.files.map((f) =>
            f.path.startsWith("schemas/") ? { ...f, sha256: "0".repeat(64) } : f,
        ),
    };
    it("exits 0 when the web manifest equals ask-dev's", () => {
        const r = run(script, ["--web-manifest", ownManifestPath]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("acr pins match");
    });
    it("exits 1 on a digest mismatch", () => {
        const r = run(script, ["--web-manifest", write("tampered.json", tampered)]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("digest differs");
    });
    it("still runs (and fails) when invoked through a symlink", () => {
        const link = path.join(dir, "link.mjs");
        fs.symlinkSync(script, link);
        const r = run(link, ["--web-manifest", write("tampered2.json", tampered)]);
        expect(r.status).toBe(1);
    });
    it("exits 2 without --web-manifest, 1 on a missing file, 1 on non-JSON", () => {
        expect(run(script, []).status).toBe(2);
        expect(run(script, ["--web-manifest", path.join(dir, "nope.json")]).status).toBe(1);
        expect(run(script, ["--web-manifest", write("junk.json", "not json")]).status).toBe(1);
    });
});
