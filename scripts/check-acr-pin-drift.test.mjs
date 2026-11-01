import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

import { checkDrift, main, sourcePathsFromManifest } from "./check-acr-pin-drift.mjs";

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

// CHAOS-12443: outcome naming. Real local git remotes; the only injected faults are a failing
// temp-dir removal and a sleep hook that heals the remote between attempts.
describe("outcome", () => {
    const manifestFor = (pin, files = [{ path: "openapi/a.json" }]) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-"));
        tmpDirs.push(dir);
        const manifest = path.join(dir, "manifest.json");
        fs.writeFileSync(manifest, JSON.stringify({ source_commit: pin, files }));
        return { manifest, out: path.join(dir, "github-output.txt") };
    };
    // Runs main() with stdout/stderr captured; returns the code, the text and the GITHUB_OUTPUT file.
    const runMain = ({ remote, pin, files, enforce }, deps = {}) => {
        const { manifest, out } = manifestFor(pin, files);
        fs.writeFileSync(out, "");
        const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const outw = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        try {
            const env = { ACR_REMOTE: remote, ACR_MANIFEST: manifest, GITHUB_OUTPUT: out };
            if (enforce !== undefined) env.ACR_PIN_ENFORCE = enforce;
            const code = main(env, deps);
            return {
                code,
                stderr: err.mock.calls.map((c) => String(c[0])).join(""),
                stdout: outw.mock.calls.map((c) => String(c[0])).join(""),
                output: fs.readFileSync(out, "utf8"),
            };
        } finally {
            err.mockRestore();
            outw.mockRestore();
        }
    };
    // The real fault seen on runners (ENOTEMPTY from rmSync), injected where it happens: fs.rmSync.
    // The spy removes the dir for real first, so tests leave nothing behind, then throws.
    const withFailingRemove = (fn) => {
        const real = fs.rmSync;
        const spy = vi.spyOn(fs, "rmSync").mockImplementation((p, o) => {
            real(p, o);
            throw new Error(`ENOTEMPTY: directory not empty, rmdir '${p}/.git/objects'`);
        });
        try {
            return fn();
        } finally {
            spy.mockRestore();
        }
    };

    it("a failed temp removal after a CLEAN measurement stays current (exit 0) and warns", () => {
        const { repo, base } = fakeAcr();
        const r = withFailingRemove(() => runMain({ remote: repo, pin: base }));
        expect(r.code).toBe(0);
        expect(r.output).toContain("status=current");
        expect(r.stderr).toMatch(/warning: .*could not remove temp dir/);
        expect(r.stderr).not.toContain("could NOT run");
    });
    it("a failed temp removal after a DRIFT measurement stays drift (exit 1)", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "planted");
        const r = withFailingRemove(() => runMain({ remote: repo, pin: base }));
        expect(r.code).toBe(1);
        expect(r.output).toContain("status=drift");
        expect(r.stderr).toMatch(/warning: .*could not remove temp dir/);
    });
    it("checkDrift returns the finished result when the removal fails", () => {
        const { repo, base } = fakeAcr();
        const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
            expect(
                withFailingRemove(() => checkDrift({ remote: repo, pin: base, paths: PATHS }))
                    .status,
            ).toBe("current");
        } finally {
            warn.mockRestore();
        }
    });
    it("a transient fetch failure that then succeeds gives the true result", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "planted");
        const away = `${repo}-away`;
        tmpDirs.push(away);
        fs.renameSync(repo, away);
        const sleeps = [];
        const r = checkDrift({
            remote: repo,
            pin: base,
            paths: PATHS,
            sleep: (ms) => {
                sleeps.push(ms);
                fs.renameSync(away, repo); // the network heals during the first backoff
            },
        });
        expect(r.status).toBe("drift");
        expect(sleeps).toHaveLength(1);
    });
    it("a fetch that keeps failing exits 2 with status=error after a bounded retry", () => {
        const sleeps = [];
        const r = runMain(
            { remote: "/nonexistent/acr.git", pin: "a".repeat(40) },
            { sleep: (ms) => sleeps.push(ms) },
        );
        expect(r.code).toBe(2);
        expect(r.output).toContain("status=error");
        expect(r.output).not.toContain("status=current");
        expect(sleeps).toHaveLength(2); // 3 attempts: the first + 2 retries
        expect(r.stderr).toContain("::error title=ACR pin drift: tool failure, not drift::");
        expect(r.stderr).not.toContain("ACR contract pin drift");
    });
    it("a broken manifest path exits 2 at once, with no retry", () => {
        const { repo, base } = fakeAcr();
        const sleeps = [];
        const r = runMain(
            { remote: repo, pin: base, files: [{ path: "openapi/no-such.json" }] },
            { sleep: (ms) => sleeps.push(ms) },
        );
        expect(r.code).toBe(2);
        expect(r.output).toContain("status=error");
        expect(sleeps).toHaveLength(0);
        // an unrecognised manifest path and a bad pin are also instant
        const bad = runMain(
            { remote: repo, pin: base, files: [{ path: "weird/x.json" }] },
            { sleep: (ms) => sleeps.push(ms) },
        );
        expect(bad.code).toBe(2);
        expect(
            runMain({ remote: repo, pin: "main" }, { sleep: (ms) => sleeps.push(ms) }).code,
        ).toBe(2);
        expect(sleeps).toHaveLength(0);
    });
    it("drift prints the drift title; a tool failure never does", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "planted");
        const r = runMain({ remote: repo, pin: base });
        expect(r.code).toBe(1);
        expect(r.stderr).toContain("::error title=ACR contract pin drift::");
        expect(r.stderr).not.toContain("tool failure");
        expect(r.output).toContain(`pin=${base}`);
    });
    it("a clean run writes status=current and no annotation", () => {
        const { repo, base } = fakeAcr();
        const r = runMain({ remote: repo, pin: base });
        expect(r.code).toBe(0);
        expect(r.output).toContain("status=current");
        expect(r.stderr).not.toContain("::error");
        expect(r.stderr).not.toContain("::warning");
    });
    it("ACR_PIN_ENFORCE=false turns annotations into warnings and keeps the exit codes", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "planted");
        const drift = runMain({ remote: repo, pin: base, enforce: "false" });
        expect(drift.code).toBe(1);
        expect(drift.stderr).toContain("::warning title=ACR contract pin drift::");
        expect(drift.stderr).not.toContain("::error");
        const tool = runMain(
            { remote: "/nonexistent/acr.git", pin: "a".repeat(40), enforce: "false" },
            { sleep: () => {} },
        );
        expect(tool.code).toBe(2);
        expect(tool.stderr).toContain("::warning title=ACR pin drift: tool failure, not drift::");
        expect(tool.stderr).not.toContain("::error");
    });
});

describe("workflow contract", () => {
    const wf = fs.readFileSync(
        path.resolve(path.dirname(SCRIPT), "../.github/workflows/acr-pin-drift.yml"),
        "utf8",
    );
    const step = (name) => {
        const i = wf.indexOf(`- name: ${name}`);
        expect(i).toBeGreaterThan(-1);
        const next = wf.indexOf("\n            - ", i + 1);
        return wf.slice(i, next === -1 ? undefined : next);
    };
    it("the PR-file step has the token; the scope step (runs PR code) does not", () => {
        expect(step("List the files this PR changes")).toContain("GH_TOKEN");
        const scope = step("Decide whether drift is enforced");
        expect(scope).not.toMatch(/GH_TOKEN|github\.token|secrets\./);
        expect(scope).toContain("scripts/acr-pin-scope.mjs");
    });
    it("checkout does not persist credentials; permissions stay narrow", () => {
        expect(wf).toMatch(/persist-credentials: false/);
        expect(wf).toMatch(/pull-requests: read/);
        expect(wf).not.toMatch(/(contents|issues|pull-requests): write/);
    });
    it("a PR that does not touch the pin cannot fail the job on drift", () => {
        expect(step("Compare the vendored pin with acr main")).toContain("continue-on-error: true");
        const fail = step("Fail when drift is enforced");
        expect(fail).toContain("steps.scope.outputs.enforce == 'true'");
        expect(fail).toContain("steps.check.outcome == 'failure'");
    });
});
