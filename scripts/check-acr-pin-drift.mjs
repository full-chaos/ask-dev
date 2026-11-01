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
// Removing the temp dir is cleanup: a failed removal is a warning and never changes the result.
// Env: ACR_REMOTE, ACR_MANIFEST, GITHUB_OUTPUT (status/pin/head are appended when set), and
// ACR_PIN_ENFORCE=false (annotations become ::warning; the exit code is unchanged).
import { execFileSync } from "node:child_process";
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
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function readPin(manifestPath) {
    const sha = JSON.parse(fs.readFileSync(manifestPath, "utf8")).source_commit;
    if (typeof sha !== "string" || !SHA_RE.test(sha)) {
        throw new ManifestError(`manifest source_commit is not a 40-char SHA: ${String(sha)}`);
    }
    return sha;
}

// Manifest path -> acr source path (inverse of artifactPath in sync-acr-contracts.mjs).
export function sourcePathsFromManifest(manifestPath) {
    const { files } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(files) || files.length === 0)
        throw new ManifestError("manifest lists no files");
    return files.map(({ path: p }) => {
        if (p.startsWith("openapi/")) return `contracts/${p}`;
        if (p.startsWith("schemas/")) return `contracts/jsonschema/v1/${p.slice(8)}`;
        if (p.startsWith("examples/")) return `contracts/examples/v1/${p.slice(9)}`;
        throw new ManifestError(`unrecognised manifest path: ${p}`);
    });
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
        const blob = (rev, file) => {
            try {
                // Only a real file counts: a directory/tree entry is never a vendored artifact.
                if (git(tmp, ["cat-file", "-t", `${rev}:${file}`]).trim() !== "blob") return null;
                return git(tmp, ["rev-parse", "--verify", "-q", `${rev}:${file}`]).trim();
            } catch {
                return null;
            }
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
                `warning: could not remove temp dir ${tmp} (result unchanged): ${error instanceof Error ? error.message : String(error)}\n`,
            );
        }
    }
}

// `sleep` is the backoff hook (tests pass a fast one).
export function checkDrift({ remote, branch = "main", pin, paths, sleep = sleepSync }) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw new ManifestError("no vendored paths to compare");
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return measureOnce({ remote, branch, pin, paths });
        } catch (error) {
            if (error instanceof ManifestError) throw error;
            lastError = error;
            if (attempt < MAX_ATTEMPTS) {
                process.stderr.write(
                    `attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying: ${firstLine(error)}\n`,
                );
                sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1));
            }
        }
    }
    throw lastError;
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
        process.stderr.write(`warning: could not write GITHUB_OUTPUT: ${firstLine(error)}\n`);
    }
}

export function main(env = process.env, deps = {}) {
    const remote = env.ACR_REMOTE ?? DEFAULT_REMOTE;
    const manifest = env.ACR_MANIFEST ?? path.join(ROOT, "src/contracts/manifest.json");
    const level = env.ACR_PIN_ENFORCE === "false" ? "warning" : "error";
    let pin = "";
    try {
        pin = readPin(manifest);
        const result = checkDrift({
            remote,
            pin,
            paths: sourcePathsFromManifest(manifest),
            ...deps,
        });
        writeOutputs(env, { status: result.status, pin, head: result.head });
        if (result.status === "current") {
            process.stdout.write(
                `ACR pin ${pin} matches acr main ${result.head} for contracts/.\n`,
            );
            return 0;
        }
        const files = result.changed.map((f) => `  ${f}`).join("\n");
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
        const message = error instanceof Error ? error.message : String(error);
        writeOutputs(env, { status: "error", pin });
        process.stderr.write(
            `ACR pin drift check could NOT run (tool failure, not drift) (remote=${remote}): ${message}\n` +
                annotate(
                    level,
                    "ACR pin drift: tool failure, not drift",
                    `The check could not measure drift${error instanceof ManifestError ? " (broken manifest or pin; not retried)" : ` after ${MAX_ATTEMPTS} attempts`}: ${firstLine(error)}`,
                ),
        );
        return 2;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.env);
}
