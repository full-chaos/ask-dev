#!/usr/bin/env node
// Reads changed file paths (one per line) from stdin and prints `enforce=true|false`.
// A PR must stay in step with acr (enforce) only when it touches the vendored ACR contracts or the pin
// machinery. Any other PR sees drift as advisory, so an acr main move never turns unrelated PRs red.
// An empty list (no changed files, or an unreadable file list) is NOT a pin change: enforce=false.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PIN_PATHS = [
    /^src\/contracts\//,
    /^scripts\/(sync-acr-contracts|acr-contract-[a-z-]+)\.mjs$/,
];

export function touchesPin(files) {
    return files.some((file) => PIN_PATHS.some((re) => re.test(file)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = fs
        .readFileSync(0, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    process.stdout.write(`enforce=${touchesPin(files)}\n`);
}
