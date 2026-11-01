#!/usr/bin/env node
// Fails when the vendored ACR contract pin has drifted from acr main (CHAOS-11907).
//
// Pin of record: source_commit in src/contracts/manifest.json.
// Drift = the pin differs from acr main AND at least one VENDORED file (the manifest list) differs
// between the two. A main that moved without touching a vendored file is not drift.
//
// Exit codes: 0 current · 1 drift · 2 the measurement did not happen (tool failure).
// A tool failure is its own named state (`status=error`, its own annotation title): never drift, and
// never "current". A fetch failure retries MAX_ATTEMPTS-1 more times (a transient network error should
// not page anyone); a broken manifest (ManifestError) is exit 2 at once, since a retry cannot fix it.
// Any failure that is not a broken input (EIO on the manifest, a failed git read) is a tool failure and is retried.
// A git READ that fails is a tool failure (retried), never "path missing" and never drift.
// Removing the temp dir is cleanup: a failed removal is a warning and never changes the result.
// Env: ACR_REMOTE, ACR_MANIFEST, GITHUB_OUTPUT (status/pin/head are appended when set), and
// ACR_PIN_ENFORCE=false (annotations become ::warning; the exit code is unchanged).
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REMOTE = "https://github.com/full-chaos/dev-health-acr.git";
const SHA_RE = /^[0-9a-f]{40}$/;
export const MAX_ATTEMPTS = 3; // the first try + 2 retries
const BACKOFF_MS = [500, 1500]; // waits before retry 1 and retry 2

// A broken manifest or pin. Retrying cannot fix it, so it is never retried.
export class ManifestError extends Error {}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function git(cwd, args) {
    return childProcess.execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
}

// Only a truly broken input is a ManifestError: file absent, invalid JSON, bad shape. Any other read
// error (EIO, EMFILE, ...) is a tool failure and is retried by withRetries.
function readManifest(manifestPath) {
    let text;
    try {
        text = fs.readFileSync(manifestPath, "utf8");
    } catch (error) {
        if (error?.code === "ENOENT")
            throw new ManifestError(`manifest absent: ${firstLine(error)}`);
        throw error;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ManifestError(`manifest is not valid JSON: ${firstLine(error)}`);
    }
}

function pinOf(manifest) {
    const sha = manifest?.source_commit;
    if (typeof sha !== "string" || !SHA_RE.test(sha)) {
        throw new ManifestError(`manifest source_commit is not a 40-char SHA: ${String(sha)}`);
    }
    return sha;
}

// Manifest path -> acr source path (inverse of artifactPath in sync-acr-contracts.mjs).
function pathsOf(manifest) {
    const files = manifest?.files;
    if (!Array.isArray(files) || files.length === 0)
        throw new ManifestError("manifest lists no files");
    return files.map((entry) => {
        const p = entry?.path;
        if (typeof p !== "string" || p === "")
            throw new ManifestError(`manifest entry has no string path: ${JSON.stringify(entry)}`);
        if (p.startsWith("openapi/")) return `contracts/${p}`;
        if (p.startsWith("schemas/")) return `contracts/jsonschema/v1/${p.slice(8)}`;
        if (p.startsWith("examples/")) return `contracts/examples/v1/${p.slice(9)}`;
        throw new ManifestError(`unrecognised manifest path: ${p}`);
    });
}

export const readPin = (manifestPath) => pinOf(readManifest(manifestPath));
export const sourcePathsFromManifest = (manifestPath) => pathsOf(readManifest(manifestPath));

// The one retry loop (manifest read and measurement). A ManifestError is rethrown at once. Any other
// error is retried up to maxAttempts; the last error carries `attempts`, the number really made.
function withRetries(fn, { sleep = sleepSync, maxAttempts = MAX_ATTEMPTS } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return fn();
        } catch (error) {
            if (error instanceof ManifestError) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
            lastError.attempts = attempt;
            if (attempt < maxAttempts) {
                process.stderr.write(
                    `attempt ${attempt}/${maxAttempts} failed, retrying: ${oneLine(firstLine(error))}\n`,
                );
                sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1));
            }
        }
    }
    throw lastError;
}

// One measurement in its own temp dir. Cleanup never replaces its result or its error.
function measureOnce({ remote, branch, pin, paths }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acr-pin-drift-"));
    try {
        git(tmp, ["init", "-q"]);
        git(tmp, ["fetch", "-q", "--depth", "1", remote, branch]);
        const head = git(tmp, ["rev-parse", "FETCH_HEAD"]).trim();
        if (!SHA_RE.test(head)) throw new Error(`acr ${branch} did not resolve to a SHA`);
        if (head !== pin) git(tmp, ["fetch", "-q", "--depth", "1", remote, pin]);
        // Compare BLOB ids per path, not `git diff`: a mode-only change is not a content change, and a
        // path that exists at neither commit is a broken manifest, never a silent green.
        // `ls-tree -z` exits 0 with empty output when the path is absent; a non-zero exit is a git
        // failure and throws (retryable). It is never turned into "missing", or one failed side would
        // read as drift. -z (NUL-terminated, unquoted) so a path git would C-quote still compares raw.
        const blob = (rev, file) => {
            const entry = git(tmp, ["ls-tree", "-z", rev, "--", file]).split("\0")[0];
            if (entry === "") return null;
            const m = /^(\d+) (\w+) ([0-9a-f]{40})\t([^]*)$/.exec(entry);
            if (!m) throw new Error(`unexpected ls-tree output for ${rev}:${file}`);
            // Only a real file counts: a directory/tree entry is never a vendored artifact.
            return m[2] === "blob" && m[4] === file ? m[3] : null;
        };
        const changed = [];
        for (const file of paths) {
            const atPin = blob(pin, file);
            const atHead = blob(head, file);
            if (atPin === null && atHead === null) {
                throw new ManifestError(`vendored path exists at neither pin nor main: ${file}`);
            }
            if (atPin !== atHead) changed.push(file);
        }
        return changed.length === 0
            ? { status: "current", pin, head }
            : { status: "drift", pin, head, changed };
    } finally {
        // A failed removal of a runner's throwaway dir is harmless: the runner is discarded. Retry a
        // little (ENOTEMPTY is a race with a late writer), then warn; never throw.
        try {
            fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
            process.stderr.write(
                `warning: could not remove temp dir ${oneLine(tmp)} (result unchanged): ${oneLine(error instanceof Error ? error.message : String(error))}\n`,
            );
        }
    }
}

// `sleep` is the backoff hook (tests pass a fast one).
export function checkDrift({
    remote,
    branch = "main",
    pin,
    paths,
    sleep = sleepSync,
    maxAttempts = MAX_ATTEMPTS,
}) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw new ManifestError("no vendored paths to compare");
    return withRetries(() => measureOnce({ remote, branch, pin, paths }), { sleep, maxAttempts });
}

// Text from outside (manifest, remote, git) is printed on ONE line, so it cannot start a `::` command.
function oneLine(v) {
    return String(v).replace(/[\r\n]+/g, " ");
}

function firstLine(error) {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}

// GitHub workflow command: one line, with the escapes the runner expects.
function annotate(level, title, message) {
    const esc = (v) => v.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    return `::${level} title=${esc(title)}::${esc(message)}\n`;
}

function writeOutputs(env, fields) {
    if (!env.GITHUB_OUTPUT) return;
    try {
        fs.appendFileSync(
            env.GITHUB_OUTPUT,
            Object.entries(fields)
                .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`)
                .join(""),
        );
    } catch (error) {
        process.stderr.write(
            `warning: could not write GITHUB_OUTPUT: ${oneLine(firstLine(error))}\n`,
        );
    }
}

export function main(env = process.env, deps = {}) {
    const remote = env.ACR_REMOTE ?? DEFAULT_REMOTE;
    const manifest = env.ACR_MANIFEST ?? path.join(ROOT, "src/contracts/manifest.json");
    const level = env.ACR_PIN_ENFORCE === "false" ? "warning" : "error";
    let pin = "";
    try {
        const parsed = withRetries(() => readManifest(manifest), deps);
        pin = pinOf(parsed);
        const result = checkDrift({ remote, pin, paths: pathsOf(parsed), ...deps });
        writeOutputs(env, { status: result.status, pin, head: result.head });
        if (result.status === "current") {
            process.stdout.write(
                `ACR pin ${pin} matches acr main ${result.head} for contracts/.\n`,
            );
            return 0;
        }
        const files = result.changed.map((f) => `  ${oneLine(f)}`).join("\n");
        process.stderr.write(
            `ACR contract pin DRIFT: pin ${pin} vs acr main ${result.head}.\nChanged among vendored files:\n${files}\nBump: pnpm acr:contracts:generate --source <acr worktree at the new SHA>, and update SOURCE_COMMIT.\n` +
                annotate(
                    level,
                    "ACR contract pin drift",
                    `pin ${pin} differs from acr main ${result.head} in: ${result.changed.join(", ")}. Bump the pin.`,
                ),
        );
        return 1;
    } catch (error) {
        const message = oneLine(error instanceof Error ? error.message : String(error));
        const made = error?.attempts;
        writeOutputs(env, { status: "error", pin });
        process.stderr.write(
            `ACR pin drift check could NOT run (tool failure, not drift) (remote=${oneLine(remote)}): ${message}\n` +
                annotate(
                    level,
                    "ACR pin drift: tool failure, not drift",
                    `The check could not measure drift${error instanceof ManifestError ? " (broken manifest or pin; not retried)" : made ? ` after ${made} attempt${made === 1 ? "" : "s"}` : " (before any measurement attempt)"}: ${firstLine(error)}`,
                ),
        );
        return 2;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.env);
}
