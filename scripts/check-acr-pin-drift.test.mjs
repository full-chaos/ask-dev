import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { checkDrift, sourcePathsFromManifest } from "./check-acr-pin-drift.mjs";

const SCRIPT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./check-acr-pin-drift.mjs",
);
const tmpDirs = [];
const PATHS = ["contracts/openapi/a.json", "contracts/jsonschema/v1/s.json"];
const g = (cwd, ...args) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();

function commit(repo, files, msg) {
    for (const [f, c] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
        fs.writeFileSync(path.join(repo, f), c);
    }
    g(repo, "add", "-A");
    g(repo, "commit", "-q", "-m", msg);
    return g(repo, "rev-parse", "HEAD");
}

function fakeAcr() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fake-acr-"));
    tmpDirs.push(repo);
    g(repo, "init", "-q", "-b", "main");
    // allow fetching an arbitrary commit by SHA
    g(repo, "config", "uploadpack.allowAnySHA1InWant", "true");
    const base = commit(
        repo,
        {
            "contracts/openapi/a.json": "1",
            "contracts/jsonschema/v1/s.json": "1",
            "README.md": "x",
        },
        "base",
    );
    return { repo, base };
}

afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("checkDrift", () => {
    it("is current when the pin is acr main", () => {
        const { repo, base } = fakeAcr();
        expect(checkDrift({ remote: repo, pin: base, paths: PATHS }).status).toBe("current");
    });
    it("is current when main moved without touching contracts/", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "README.md": "y" }, "docs only");
        expect(checkDrift({ remote: repo, pin: base, paths: PATHS }).status).toBe("current");
    });
    it("is current when only a contract file NOT in the manifest changed (an mcp_* schema web does not vendor)", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/jsonschema/v1/mcp_x.v1.schema.json": "2" }, "mcp only");
        expect(checkDrift({ remote: repo, pin: base, paths: PATHS }).status).toBe("current");
    });
    it("is drift when a manifest-listed mcp_* file changed (it IS vendored)", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/jsonschema/v1/mcp_v.v1.schema.json": "1" }, "add");
        const pin = g(repo, "rev-parse", "HEAD");
        commit(repo, { "contracts/jsonschema/v1/mcp_v.v1.schema.json": "2" }, "change");
        const r = checkDrift({
            remote: repo,
            pin,
            paths: [...PATHS, "contracts/jsonschema/v1/mcp_v.v1.schema.json"],
        });
        expect(r.status).toBe("drift");
        expect(base).toBeTruthy();
    });
    it("is current for a mode-only change (same content)", () => {
        const { repo, base } = fakeAcr();
        fs.chmodSync(path.join(repo, "contracts/openapi/a.json"), 0o755);
        g(repo, "add", "-A");
        g(repo, "commit", "-q", "-m", "mode");
        expect(checkDrift({ remote: repo, pin: base, paths: PATHS }).status).toBe("current");
    });
    it("THROWS when a manifest path exists at neither commit, or is a glob", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "change");
        for (const bad of ["contracts/openapi/no-such.json", "contracts/openapi/*.json"]) {
            expect(() => checkDrift({ remote: repo, pin: base, paths: [bad] })).toThrow(
                /neither pin nor main/,
            );
        }
    });
    it("THROWS on a bad manifest path even when the pin IS acr main", () => {
        const { repo, base } = fakeAcr();
        expect(() =>
            checkDrift({ remote: repo, pin: base, paths: ["contracts/openapi/missing.json"] }),
        ).toThrow(/neither pin nor main/);
    });
    it("rejects a directory entry as a vendored path", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "change");
        expect(() =>
            checkDrift({
                remote: repo,
                pin: base,
                paths: ["contracts/openapi", "contracts/jsonschema/v1"],
            }),
        ).toThrow(/neither pin nor main/);
    });
    it("the real manifest maps to EXACTLY the generator's source path list", () => {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const sync = fs.readFileSync(path.join(root, "scripts/sync-acr-contracts.mjs"), "utf8");
        const declared = [...sync.matchAll(/^\s*"(contracts\/[^"]+)",$/gm)].map((m) => m[1]).sort();
        const mapped = sourcePathsFromManifest(
            path.join(root, "src/contracts/manifest.json"),
        ).sort();
        expect(declared.length).toBeGreaterThan(10);
        expect(mapped).toEqual(declared);
    });
    it("maps manifest paths back to acr source paths", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-"));
        tmpDirs.push(dir);
        const m = path.join(dir, "m.json");
        fs.writeFileSync(
            m,
            JSON.stringify({
                files: [
                    { path: "openapi/a.json" },
                    { path: "schemas/s.json" },
                    { path: "examples/e.json" },
                ],
            }),
        );
        expect(sourcePathsFromManifest(m)).toEqual([
            "contracts/openapi/a.json",
            "contracts/jsonschema/v1/s.json",
            "contracts/examples/v1/e.json",
        ]);
    });
    it("is drift when contracts/ changed after the pin", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "contract change");
        const r = checkDrift({ remote: repo, pin: base, paths: PATHS });
        expect(r.status).toBe("drift");
        expect(r.changed).toEqual(["contracts/openapi/a.json"]);
    });
    it("THROWS (never passes) when the remote cannot be fetched", () => {
        expect(() =>
            checkDrift({ remote: "/nonexistent/acr.git", pin: "a".repeat(40), paths: PATHS }),
        ).toThrow();
    });
});

describe("cli exit codes", () => {
    const run = (remote, pin) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-"));
        tmpDirs.push(dir);
        const manifest = path.join(dir, "manifest.json");
        fs.writeFileSync(
            manifest,
            JSON.stringify({ source_commit: pin, files: [{ path: "openapi/a.json" }] }),
        );
        return spawnSync("node", [SCRIPT], {
            env: { ...process.env, ACR_REMOTE: remote, ACR_MANIFEST: manifest },
            encoding: "utf8",
        });
    };
    it("exits 0 on a clean pin", () => {
        const { repo, base } = fakeAcr();
        expect(run(repo, base).status).toBe(0);
    });
    it("exits 1 on planted drift", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "planted");
        const r = run(repo, base);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("DRIFT");
    });
    it("exits 2 on fetch failure", () => {
        const r = run("/nonexistent/acr.git", "a".repeat(40));
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("could NOT run");
    });
    it("exits 2 on a malformed pin", () => {
        const { repo } = fakeAcr();
        expect(run(repo, "main").status).toBe(2);
    });
});
