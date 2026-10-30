#!/usr/bin/env node
// Fails when the vendored ACR contract pin has drifted from acr main (CHAOS-11907).
//
// Pin of record: source_commit in src/contracts/manifest.json.
// Drift = the pin differs from acr main AND at least one VENDORED file (the manifest list) differs
// between the two. A main that moved without touching a vendored file is not drift.
//
// Exit codes: 0 current · 1 drift · 2 the measurement did not happen (fetch/parse failure).
// A failed fetch must never read as "current".
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REMOTE = "https://github.com/full-chaos/dev-health-acr.git";
const SHA_RE = /^[0-9a-f]{40}$/;

function git(cwd, args) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function readPin(manifestPath) {
    const sha = JSON.parse(fs.readFileSync(manifestPath, "utf8")).source_commit;
    if (typeof sha !== "string" || !SHA_RE.test(sha)) {
        throw new Error(`manifest source_commit is not a 40-char SHA: ${String(sha)}`);
    }
    return sha;
}

// Manifest path -> acr source path (inverse of artifactPath in sync-acr-contracts.mjs).
export function sourcePathsFromManifest(manifestPath) {
    const { files } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(files) || files.length === 0) throw new Error("manifest lists no files");
    return files.map(({ path: p }) => {
        if (p.startsWith("openapi/")) return `contracts/${p}`;
        if (p.startsWith("schemas/")) return `contracts/jsonschema/v1/${p.slice(8)}`;
        if (p.startsWith("examples/")) return `contracts/examples/v1/${p.slice(9)}`;
        throw new Error(`unrecognised manifest path: ${p}`);
    });
}

export function checkDrift({ remote, branch = "main", pin, paths }) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw new Error("no vendored paths to compare");
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
                throw new Error(`vendored path exists at neither pin nor main: ${file}`);
            }
            if (atPin !== atHead) changed.push(file);
        }
        return changed.length === 0
            ? { status: "current", pin, head }
            : { status: "drift", pin, head, changed };
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function main() {
    const remote = process.env.ACR_REMOTE ?? DEFAULT_REMOTE;
    const manifest = process.env.ACR_MANIFEST ?? path.join(ROOT, "src/contracts/manifest.json");
    try {
        const pin = readPin(manifest);
        const result = checkDrift({ remote, pin, paths: sourcePathsFromManifest(manifest) });
        if (result.status === "current") {
            process.stdout.write(
                `ACR pin ${pin} matches acr main ${result.head} for contracts/.\n`,
            );
            return 0;
        }
        process.stderr.write(
            `ACR contract pin DRIFT: pin ${pin} vs acr main ${result.head}.\nChanged among vendored files:\n${result.changed.map((f) => `  ${f}`).join("\n")}\nBump: pnpm acr:contracts:generate --source <acr worktree at the new SHA>, and update SOURCE_COMMIT.\n`,
        );
        return 1;
    } catch (error) {
        process.stderr.write(
            `ACR pin drift check could NOT run (remote=${remote}): ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return 2;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main();
}
