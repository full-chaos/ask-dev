import childProcess, { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
    checkDrift,
    main,
    ManifestError,
    sourcePathsFromManifest,
} from "./check-acr-pin-drift.mjs";

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

// CHAOS-12443: outcome naming. Real local git remotes; the only injected faults are a failing
// temp-dir removal and a sleep hook that heals the remote between attempts.
describe("outcome", () => {
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

describe("git read failures and output hygiene", () => {
    // Fail the per-path git reads (`ls-tree`, or `cat-file` in older code) (the per-path blob read) for revs where `match(rev)` is true, for
    // the first `times` calls. Every other git call is the real git.
    const failReads = (match, times, fn) => {
        const real = childProcess.execFileSync;
        let failed = 0;
        const spy = vi.spyOn(childProcess, "execFileSync").mockImplementation((cmd, args, o) => {
            if (
                cmd === "git" &&
                (args.includes("ls-tree") || args.includes("cat-file")) &&
                match(args) &&
                failed < times
            ) {
                failed++;
                throw new Error("fatal: simulated git read failure");
            }
            return real(cmd, args, o);
        });
        try {
            return fn(() => failed);
        } finally {
            spy.mockRestore();
        }
    };
    const quiet = () => vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const catchErr = (fn) => {
        try {
            fn();
        } catch (e) {
            return e;
        }
        return undefined;
    };

    it("a failed read on ONE side is retried and never reads as drift", () => {
        const { repo, base } = fakeAcr();
        const head = commit(repo, { "README.md": "y" }, "docs only"); // contracts identical: truly current
        const err = quiet();
        try {
            const sleeps = [];
            const r = failReads(
                (a) => a.some((x) => String(x).startsWith(base)),
                1,
                () =>
                    checkDrift({
                        remote: repo,
                        pin: base,
                        paths: PATHS,
                        sleep: (m) => sleeps.push(m),
                    }),
            );
            expect(r.status).toBe("current");
            expect(r.head).toBe(head);
            expect(sleeps).toHaveLength(1);
        } finally {
            err.mockRestore();
        }
    });
    it("a persistent failed read on one side exits 2, never drift", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "README.md": "y" }, "docs only");
        const sleeps = [];
        const r = failReads(
            (a) => a.some((x) => String(x).startsWith(base)),
            99,
            () => runMain({ remote: repo, pin: base }, { sleep: (m) => sleeps.push(m) }),
        );
        expect(r.code).toBe(2);
        expect(r.output).toContain("status=error");
        expect(r.output).not.toContain("status=drift");
        expect(sleeps).toHaveLength(2);
        expect(r.stderr).toContain("after 3 attempts");
    });
    it("failed reads on BOTH sides are retried and are not a ManifestError", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/a.json": "2" }, "change");
        const err = quiet();
        try {
            const sleeps = [];
            const e = failReads(
                () => true,
                99,
                () =>
                    catchErr(() =>
                        checkDrift({
                            remote: repo,
                            pin: base,
                            paths: PATHS,
                            sleep: (m) => sleeps.push(m),
                        }),
                    ),
            );
            expect(e).toBeInstanceOf(Error);
            expect(e).not.toBeInstanceOf(ManifestError);
            expect(sleeps).toHaveLength(2);
        } finally {
            err.mockRestore();
        }
    });
    it("a missing path is still told apart from a failed read (neither side has it)", () => {
        const { repo, base } = fakeAcr();
        const sleeps = [];
        const e = catchErr(() =>
            checkDrift({
                remote: repo,
                pin: base,
                paths: ["contracts/nope.json"],
                sleep: (m) => sleeps.push(m),
            }),
        );
        expect(e).toBeInstanceOf(ManifestError);
        expect(sleeps).toHaveLength(0);
    });
    it("a path present only at acr main is drift, not a failure", () => {
        const { repo, base } = fakeAcr();
        commit(repo, { "contracts/openapi/new.json": "1" }, "add");
        const r = checkDrift({ remote: repo, pin: base, paths: ["contracts/openapi/new.json"] });
        expect(r.status).toBe("drift");
    });

    it("a manifest path holding a newline cannot forge a workflow command", () => {
        const { repo, base } = fakeAcr();
        const evil = "openapi/x\n::error title=forged::pwned";
        for (const enforce of [undefined, "false"]) {
            const r = runMain({ remote: repo, pin: base, files: [{ path: evil }], enforce });
            expect(r.code).toBe(2);
            const lines = r.stderr.split("\n").filter((l) => l.startsWith("::"));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatch(
                /^::(error|warning) title=ACR pin drift: tool failure, not drift::/,
            );
        }
    });
    it("a remote holding a newline cannot forge a workflow command", () => {
        const sleeps = [];
        const r = runMain(
            { remote: "/nonexistent/x\n::error title=forged::pwned", pin: "a".repeat(40) },
            { sleep: (m) => sleeps.push(m) },
        );
        expect(r.code).toBe(2);
        expect(r.stderr.split("\n").filter((l) => l.startsWith("::"))).toHaveLength(1);
        expect(r.stderr.split("\n").some((l) => l.startsWith("::error title=forged"))).toBe(false);
    });
    it("the cleanup warning cannot forge a workflow command", () => {
        const { repo, base } = fakeAcr();
        const real = fs.rmSync;
        const spy = vi.spyOn(fs, "rmSync").mockImplementation((p, o) => {
            real(p, o);
            throw new Error("boom\n::error title=forged::pwned");
        });
        let r;
        try {
            r = runMain({ remote: repo, pin: base });
        } finally {
            spy.mockRestore();
        }
        expect(r.code).toBe(0);
        expect(r.stderr).toContain("could not remove temp dir");
        expect(r.stderr.split("\n").filter((l) => l.startsWith("::"))).toHaveLength(0);
    });

    it("a null manifest path is a ManifestError: exit 2, one attempt, no retry text", () => {
        const { repo, base } = fakeAcr();
        const sleeps = [];
        for (const files of [[{ path: null }], [null], [{ path: 5 }], [{}]]) {
            const r = runMain({ remote: repo, pin: base, files }, { sleep: (m) => sleeps.push(m) });
            expect(r.code).toBe(2);
            expect(r.output).toContain("status=error");
            expect(r.stderr).not.toMatch(/after \d+ attempts/);
            expect(r.stderr).toContain("broken manifest or pin; not retried");
        }
        expect(sleeps).toHaveLength(0);
    });
    it("an unparsable manifest is a ManifestError, not 'after 3 attempts'", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-"));
        tmpDirs.push(dir);
        const manifest = path.join(dir, "manifest.json");
        fs.writeFileSync(manifest, "{ not json");
        const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        let code;
        let text;
        try {
            code = main({ ACR_REMOTE: "/nonexistent/acr.git", ACR_MANIFEST: manifest }, {});
            text = err.mock.calls.map((c) => String(c[0])).join("");
        } finally {
            err.mockRestore();
        }
        expect(code).toBe(2);
        expect(text).not.toMatch(/after \d+ attempts/);
    });
    it("the attempts text follows the attempts really made, not the default", () => {
        const sleeps = [];
        const r = runMain(
            { remote: "/nonexistent/acr.git", pin: "a".repeat(40) },
            { sleep: (m) => sleeps.push(m), maxAttempts: 2 },
        );
        expect(r.code).toBe(2);
        expect(sleeps).toHaveLength(1);
        expect(r.stderr).toContain("after 2 attempts");
        expect(r.stderr).not.toContain("after 3 attempts");
    });
    it("the attempts text states the attempts really made", () => {
        const r = runMain(
            { remote: "/nonexistent/acr.git", pin: "a".repeat(40) },
            { sleep: () => {} },
        );
        expect(r.stderr).toContain("after 3 attempts");
        // the recovered-after-retry path logs the attempt that failed, with its real number
        expect(r.stderr).toContain("attempt 1/3 failed");
        expect(r.stderr).toContain("attempt 2/3 failed");
        expect(r.stderr).not.toContain("attempt 3/3 failed");
    });
});

describe("manifest read failures and raw paths", () => {
    // Fail the first `times` reads of a manifest file with the given errno; every other read is real.
    const failManifestReads = (code, times, fn) => {
        const real = fs.readFileSync;
        let failed = 0;
        const spy = vi.spyOn(fs, "readFileSync").mockImplementation((p, ...rest) => {
            if (String(p).endsWith(`${path.sep}manifest.json`) && failed < times) {
                failed++;
                throw Object.assign(new Error(`${code}: simulated manifest read failure`), {
                    code,
                });
            }
            return real(p, ...rest);
        });
        try {
            return fn(() => failed);
        } finally {
            spy.mockRestore();
        }
    };

    it("a first manifest read that throws EIO is retried once and gives the true result", () => {
        const { repo, base } = fakeAcr();
        const sleeps = [];
        const r = failManifestReads("EIO", 1, () =>
            runMain({ remote: repo, pin: base }, { sleep: (m) => sleeps.push(m) }),
        );
        expect(r.code).toBe(0);
        expect(r.output).toContain("status=current");
        expect(sleeps).toHaveLength(1);
    });
    it("a manifest read that keeps throwing EIO is a tool failure after the real attempts", () => {
        const { repo, base } = fakeAcr();
        const sleeps = [];
        const r = failManifestReads("EIO", 99, () =>
            runMain({ remote: repo, pin: base }, { sleep: (m) => sleeps.push(m) }),
        );
        expect(r.code).toBe(2);
        expect(r.output).toContain("status=error");
        expect(sleeps).toHaveLength(2);
        expect(r.stderr).toContain("after 3 attempts");
        expect(r.stderr).not.toContain("not retried");
    });
    it("an absent manifest (ENOENT) is a ManifestError and is not retried", () => {
        const sleeps = [];
        const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        let code;
        let text;
        try {
            code = main(
                {
                    ACR_REMOTE: "/nonexistent/acr.git",
                    ACR_MANIFEST: "/nonexistent/dir/manifest.json",
                },
                { sleep: (m) => sleeps.push(m) },
            );
            text = err.mock.calls.map((c) => String(c[0])).join("");
        } finally {
            err.mockRestore();
        }
        expect(code).toBe(2);
        expect(sleeps).toHaveLength(0);
        expect(text).toContain("broken manifest or pin; not retried");
    });

    it("a path with a newline or a non-ASCII byte is read raw (not C-quoted by git)", () => {
        const odd = ["contracts/openapi/we\nird.json", "contracts/openapi/caf\u00e9.json"];
        const { repo, base: first } = fakeAcr();
        const pin = commit(repo, Object.fromEntries(odd.map((f) => [f, "1"])), "add odd paths");
        expect(first).not.toBe(pin);
        expect(checkDrift({ remote: repo, pin, paths: odd }).status).toBe("current");
        commit(repo, { [odd[0]]: "2" }, "change the newline path");
        const r = checkDrift({ remote: repo, pin, paths: odd });
        expect(r.status).toBe("drift");
        expect(r.changed).toEqual([odd[0]]);
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
