#!/usr/bin/env node
/**
 * Generates a THROWAWAY Ed25519 keypair for the "configured" e2e webServer.
 *
 * `loadAcrRuntimeConfig` (src/lib/acr/config.ts) requires
 * `ACR_WEB_ASSERTION_KEY_FILE` to point at a readable, valid private key —
 * the app signs every outgoing request with it regardless of who is on the
 * other end. `tests/support/fake-acr-server.mjs` never verifies the
 * signature (see its own file header), so this key never has to match
 * anything ACR-side; it only has to exist and parse. Generated fresh per run
 * rather than committed, so there is nothing here for a secret scanner to
 * flag and nothing that could ever be mistaken for a real credential.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outPath = process.argv[2];
if (outPath === undefined) {
    console.error("usage: gen-e2e-key.mjs <output-path>");
    process.exit(1);
}

const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, pem, { mode: 0o600 });
console.log(`e2e signing key written to ${outPath}`);
