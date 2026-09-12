#!/usr/bin/env node
/**
 * CHAOS-5620: a small, dependency-free (uses only what's already in
 * package.json: ajv + ajv-formats, the same libraries and options
 * src/lib/acr/validate.ts already uses in product code) shim so the
 * Python corpus tooling can validate a payload against the REAL pinned
 * contract schemas -- or against ask-dev's own `corpus/schemas/*.json`
 * (for shapes, like the `any_of` expectation declaration, that are this
 * repo's own invention, not part of acr's wire contract) -- through one
 * battle-tested JSON Schema validator, instead of hand-rolled Python
 * shape checks that can miss a cell (a null where absence was checked,
 * a type mix `sorted()` cannot order) or silently diverge from the real
 * contract over time.
 *
 * Usage: node scripts/validate_json_schema.mjs <schemaFile> <jsonPointer>
 *   <schemaFile>   a file name under src/contracts/schemas/ or
 *                  corpus/schemas/ (this script registers BOTH
 *                  directories' schemas with one ajv instance, so a
 *                  corpus/schemas/ schema may $ref into a
 *                  src/contracts/schemas/ one, e.g. for QuestionFamily).
 *   <jsonPointer>  '' for the schema's own root, or e.g.
 *                  '#/$defs/WindowOption' for one of its named shapes.
 *   stdin          the JSON payload to validate.
 *   stdout         exactly one line: {"valid": bool, "errors": [string, ...],
 *                  "orderedAscending": bool|null}. `orderedAscending` is
 *                  computed (via JS `Date.parse`, never a caller-supplied
 *                  parser) whenever the payload is an object carrying both
 *                  a `start` and an `end` string -- true/false/null (not
 *                  computable, e.g. an unparseable value slipped past
 *                  `format: date-time` some other way). Callers needing an
 *                  ordering fact read it from here; nothing on the Python
 *                  side parses a timestamp of its own.
 *   exit code      0 if the payload is valid, 1 if invalid, 2 on a usage
 *                  or schema-loading error (never conflated with 1 --
 *                  callers must not read a broken shim as "invalid input").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Plain node ESM (this is a standalone script, not bundled by Next.js/
// webpack the way src/lib/acr/validate.ts is) needs the explicit .js
// extension; webpack resolves the extensionless form validate.ts uses,
// but `node` itself does not.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIRS = [path.join(ROOT, "src/contracts/schemas"), path.join(ROOT, "corpus/schemas")];

function die(message) {
    process.stderr.write(`validate_json_schema: ${message}\n`);
    process.exit(2);
}

const [schemaFile, jsonPointer] = process.argv.slice(2);
if (!schemaFile) die("usage: validate_json_schema.mjs <schemaFile> [jsonPointer] < payload.json");

const ajv = new Ajv2020({
    allErrors: true,
    strictRequired: false,
    strictSchema: true,
    strictTypes: false,
});
addFormats(ajv);

// Register every schema file from both directories up front (by its own
// bare filename), so a $ref from one directory into the other resolves --
// exactly as src/lib/acr/validate.ts registers its own four files
// together, just widened to ALSO include corpus/schemas/.
for (const dir of SCHEMA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const schema = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        ajv.addSchema(schema, name);
    }
}

const validator = ajv.getSchema(jsonPointer ? `${schemaFile}${jsonPointer}` : schemaFile);
if (validator === undefined) die(`schema is unavailable: ${schemaFile}${jsonPointer ?? ""}`);

let payload;
try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (error) {
    die(`stdin is not valid JSON: ${error.message}`);
}

const valid = validator(payload);
const errors = valid
    ? []
    : (validator.errors ?? []).map(
          (error) => `${error.instancePath} ${error.message ?? error.keyword}`,
      );

// Ordering is a FACT about the payload's own start/end, not a validity
// rule the schema itself expresses (JSON Schema has no "field A before
// field B" keyword) -- computed here, in JS, so no caller ever parses a
// timestamp string itself.
let orderedAscending = null;
if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "start" in payload &&
    "end" in payload
) {
    const startMs = Date.parse(payload.start);
    const endMs = Date.parse(payload.end);
    orderedAscending = Number.isFinite(startMs) && Number.isFinite(endMs) ? startMs < endMs : null;
}

process.stdout.write(JSON.stringify({ valid, errors, orderedAscending }) + "\n");
process.exit(valid ? 0 : 1);
