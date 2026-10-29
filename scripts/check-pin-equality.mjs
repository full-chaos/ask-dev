#!/usr/bin/env node
/**
 * CHAOS-11906 / plan-v5 §2.3 (INV-4): web is the acr pin of record; ask-dev
 * carries the SAME acr SHA. This proves it from the two committed manifests.
 *
 *   node scripts/check-pin-equality.mjs --web-manifest <path-or-https-url>
 *
 * Fails (exit 1) when either:
 *   - `source_commit` differs, or
 *   - any `schemas/*` file ask-dev vendors is missing from web's manifest or
 *     has a different sha256.
 * Examples are NOT compared: web does not vendor the context-fabric examples,
 * so absence there is expected. Same commit + equal schema digests is the claim.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function comparePins(askDev, web) {
    const problems = [];
    if (typeof askDev?.source_commit !== "string" || askDev.source_commit === "") {
        problems.push("ask-dev manifest has no source_commit");
    }
    if (typeof web?.source_commit !== "string" || web.source_commit === "") {
        problems.push("web manifest has no source_commit");
    }
    if (problems.length > 0) return problems;
    if (askDev.source_commit !== web.source_commit) {
        problems.push(
            `source_commit differs: ask-dev ${askDev.source_commit} vs web ${web.source_commit}`,
        );
    }
    const webDigests = new Map((web.files ?? []).map((f) => [f.path, f.sha256]));
    let compared = 0;
    for (const file of askDev.files ?? []) {
        if (!file.path.startsWith("schemas/")) continue;
        compared += 1;
        if (!webDigests.has(file.path)) {
            problems.push(`web does not vendor ${file.path}`);
        } else if (webDigests.get(file.path) !== file.sha256) {
            problems.push(`digest differs for ${file.path}`);
        }
    }
    if (compared === 0) problems.push("ask-dev manifest lists no schemas/ files; nothing compared");
    return problems;
}

async function readManifest(source) {
    if (/^https:\/\//u.test(source)) {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`GET ${source} -> ${response.status}`);
        return JSON.parse(await response.text());
    }
    return JSON.parse(fs.readFileSync(source, "utf8"));
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
    const flag = process.argv.indexOf("--web-manifest");
    const webSource = flag === -1 ? undefined : process.argv[flag + 1];
    if (webSource === undefined) {
        process.stderr.write("usage: check-pin-equality.mjs --web-manifest <path-or-https-url>\n");
        process.exit(2);
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    try {
        const askDev = JSON.parse(
            fs.readFileSync(path.join(root, "src/contracts/manifest.json"), "utf8"),
        );
        const problems = comparePins(askDev, await readManifest(webSource));
        if (problems.length > 0) {
            for (const problem of problems) process.stderr.write(`pin mismatch: ${problem}\n`);
            process.exit(1);
        }
        process.stdout.write(`acr pins match at ${askDev.source_commit}\n`);
    } catch (error) {
        process.stderr.write(`pin equality check could not run: ${String(error)}\n`);
        process.exit(1);
    }
}
