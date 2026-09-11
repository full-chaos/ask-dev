#!/usr/bin/env node
/**
 * Copies the ACR Context Fabric contract surface this workbench consumes out of
 * a pinned acr commit, and derives the TypeScript types from those copies.
 *
 * Modeled on dev-health-web's scripts/sync-acr-contracts.mjs. Two rules carry
 * over verbatim, and everything here exists to enforce them:
 *
 *   1. Generated artifacts are NEVER hand-edited. This script is their only
 *      author.
 *   2. Regeneration is CI-checked by EXACT DIFF. `check` recomputes every
 *      artifact and fails on the first byte of drift.
 *
 * `check` runs with no acr checkout: it re-reads the committed copies, verifies
 * each against the manifest digest, and regenerates the types from them. That
 * catches a hand-edit of a copy, a hand-edit of a generated type, and a stale
 * type after a pin bump. Pass `--source <acr worktree>` to additionally prove
 * the committed copies still equal the pinned commit's blobs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(ROOT, "src/contracts");

// acr main: pins past #427 ("Say what an answer's charged items were
// about"), #429 (devhealthfacts subject-shape disclosure), #431/#433
// (design-doc updates only) and #430 ("Publish the derived requirement
// rows, and say what refined each"). Of the commits between the prior pin
// and this one, only #430 touches the consumed contract surface (verified
// over the full `contracts/` tree: `git diff
// 5a3ab55b588faa5091fa8f6b15b864cec5055f04
// 0a172f937c27364d717313478845827aa081e875 -- contracts/` shows four files
// changed; only one, context_fabric_common.v1, is part of this repo's
// vendored surface -- the other three (context_fabric_answer_projection.v1,
// mcp_investigate_question_response.v1, mcp_investigation_result_response.v1)
// are MCP/answer-projection schemas this repo does not vendor):
//   - `context_fabric_common.v1` grows two new $defs, both
//     `additionalProperties:false`: `RequirementRefinement` (one reduction
//     step -- stage/basis/overrun/coverage/before/after) and
//     `PlanRequirement` (one derived requirement row --
//     obligation/role/subject/kind/scope/quantifier, plus computed-step
//     detail -- fact_kinds/step/step_execution/input_class/
//     input_fact_kinds -- and an `unavailable` reason). `AnswerPlan` grows
//     an optional `requirements[]` (<=200) of `PlanRequirement`. The
//     outcome-row object (required stage/outcome/impact/cause_observed/
//     served/declared) grows an optional `refinements[]` (<=4) of
//     `RequirementRefinement`. The degrading-cause enum gains one member,
//     `answer_terminated_before_attempt` (a veto exit's gap rows; wired at
//     acr internal/contextfabric/requirement_outcomes.go:120,159, already
//     live at this pin).
// Every new field is schema-OPTIONAL and the new enum member is additive --
// this pin validates BOTH the old 5a3ab55b and the new 0a172f93 acr
// response shapes -- so this is a NORMAL two-step deploy (consumer pin
// first, acr server second). Bumped now, ahead of the acr rig leg advance,
// because `answer_terminated_before_attempt` is already emitted on live
// veto-exit paths at this acr sha: without this bump the rig's ask-dev leg
// would reject those responses with `acr_contract_violation`. Bump
// procedure lives in README.md.
//
// 0a172f93 -> c6aaa727: 10 commits, only #438 ("evaluate read
// requirements against the evidence that served them") and #435 ("Qualify
// a count taken over a population the answer never saw all of") touch
// `contracts/`. Verified over the full tree (`git diff 0a172f93 c6aaa727 --
// contracts/`): the SAME single change appears in four schema files --
// `context_fabric_common.v1`, `context_fabric_answer_projection.v1`,
// `mcp_investigate_question_response.v1`,
// `mcp_investigation_result_response.v1` -- and only the first is part of
// this repo's vendored surface (the other three are MCP/answer-projection
// schemas this repo does not vendor, same shape as the prior bump).
//   - `context_fabric_common.v1`'s `CoverageDetail.code` (the degrading-cause
//     enum) gains two members, one from each commit: `population_truncated`
//     (#435 -- a value computed over a member set the cohort itself says is
//     a strict subset of the population the question named -- acr
//     internal/contracts/v1/context_fabric_coverage_detail.go's
//     ContextFabricCoverageDetailPopulationTruncated) and
//     `requirement_read_not_planned` (#438 -- a READ requirement the plan
//     published that no planned fact of any kind could serve, so it was
//     never attempted at all --
//     ContextFabricCoverageDetailRequirementReadNotPlanned, same file).
//     Both additive; no other field, $def, or required-list change in the
//     consumed schema.
// Bumped ahead of the acr rig leg advance for the same reason as the prior
// pin: both new codes are wired at this acr sha, and the rig's population-
// counting (#435) and read-evaluation (#438) paths can already emit them --
// without this bump the rig's ask-dev leg would reject those responses
// with `acr_contract_violation`.
//
// 084ab9c4 -> 0945a53d: 1 commit (#477, CHAOS-5442). Only
// `context_fabric_common.v1` changes in the vendored surface (verified over
// the full tree, `git diff 084ab9c4 0945a53d -- contracts/`: six schema
// files change, but the other five --
// `context_fabric_answer_projection.v1`,
// `context_fabric_investigation_result.v1`/`.v2`,
// `mcp_investigate_question_response.v1`,
// `mcp_investigation_result_response.v1` -- are MCP/answer-projection/older
// result-version schemas this repo does not vendor, same shape as both
// prior bumps).
//   - One new property, `refusal_basis`: an optional string over a closed
//     three-member vocabulary (`member_kind_unservable`,
//     `frame_invariant_violated`, `unspecified`). ABSENT on every turn that
//     was not refused; present and one of the three members whenever the
//     frame gate refused a turn before retrieval ran. Names WHY the server
//     refused, orthogonal to `terminal_reason` (which names the channel an
//     explanation travelled through). One physical addition in this
//     vendored schema serves both the result root and the completeness
//     block, which share the same $def.
// The server (acr internal/contextfabric) already emits this field at this
// sha on every frame-gate refusal. **Load-bearing before acr deploys to
// this consumer**: ask-dev validates every acr response with
// `additionalProperties: false` and fails closed
// (`acr_contract_violation`, `retryable: false`) on an unrecognised field
// in the OTHER direction (a response the schema doesn't expect), and this
// bump only ADDS an optional field, so an un-bumped ask-dev leg does not
// reject a refusal response merely for carrying it -- but the deployed and
// rig ask-dev legs still take this bump first, per standing practice for
// every acr contract-surface pin, so the type system and generated
// fixtures see the field ask-dev's own request/response handling may need
// to branch on.
// 0945a53d -> b8df5dde: 15 commits, only #490 (CHAOS-5405, acr fca2ddad)
// touches the vendored surface. Verified over the full tree (`git diff
// 0945a53dfdad0e84ba8244c59e8e9d85a7d195f2
// b8df5ddea287e383daa226dd3234a8bfbaa8062b -- contracts/`): two of the four
// vendored schema files change.
//   - `context_fabric_common.v1` gains one new `$def`,
//     `FactScopeCensusRecord` (additionalProperties:false, all 11 properties
//     required): one attempted requirement/origin scope decision as served
//     -- requirement_kind, origin_kind, policy, basis, axis, outcome,
//     target_limit, population_measured, admitted_count, truncated (all
//     required non-null), plus `authorized_population_count` (required but
//     NULLABLE: null means the census did not complete, 0 means it did and
//     the caller-visible population is genuinely none).
//   - `context_fabric_investigation_result.v1` gains one new optional
//     top-level field, `fact_scope_census` (array of `FactScopeCensusRecord`,
//     maxItems 21). Absent on every result written before this field
//     existed and on any path that resolved no scope at all -- absent and
//     empty are different documents.
// `context_fabric_investigation_request.v1` and `error.v1` and all four
// pinned examples are byte-identical to the prior pin.
//
// THIS BUMP IS NOT OPTIONAL: `context_fabric_investigation_result.v1` is
// `additionalProperties:false` here, so without it every served answer that
// resolved any requirement/origin scope is rejected by validate.ts as
// `acr_contract_violation` instead of served -- acr main already emits this
// field on every such path at this sha (measured against a real served
// answer before this pin moved: 502 acr_contract_violation before, 200
// after, same acr-api and same request).
//
// b8df5dde -> d949d18c: found by THIS repo's own PR #54 (CHAOS-5552) r1
// reviewer, on the SYNCED copy landed by the bump directly above: the prior
// pin declared `authorized_population_count` NULLABLE with the prose
// invariant quoted above ("null means the census did not complete, 0 means
// it did...") but never ENFORCED it -- a document with
// `population_measured: false` beside a non-null count, or `true` beside
// null, validated clean. Verified over the full tree (`git diff
// b8df5ddea287e383daa226dd3234a8bfbaa8062b
// d949d18cb41b8970867eaf31b0bde48710d35956 -- contracts/`): four vendored
// schema files change (all four commits between the two pins landed on
// acr's own #501, one PR); only ONE is part of this repo's vendored
// surface.
//   - `context_fabric_common.v1`'s `FactScopeCensusRecord` gains an
//     `if`/`then`/`else`: `population_measured: true` now requires
//     `authorized_population_count` typed strictly `integer` (0 legal);
//     `population_measured: false` now requires it typed strictly `null`.
//     No property added or removed, no required-list change -- a
//     document that was CORRECTLY shaped under the old pin (agreeing
//     values) still validates; only a SELF-CONTRADICTORY document (the
//     shape the field was made nullable specifically to make
//     distinguishable, then never enforced) newly fails.
//   - `context_fabric_answer_projection.v1`,
//     `mcp_investigate_question_response.v1`, and
//     `mcp_investigation_result_response.v1` also change (the identical
//     if/then/else, propagated to the projection's own local duplicate and
//     the two MCP embedded copies) but none of the three is part of this
//     repo's vendored surface -- same exclusion as the prior bump's note
//     above.
// `context_fabric_investigation_request.v1`, `error.v1`, and all four
// pinned examples are byte-identical to the prior pin.
//
// THIS BUMP IS NOT LOAD-BEARING FOR SERVED TRAFFIC THE WAY THE PRIOR ONE
// WAS: acr's own producer (`internal/contextfabric/fact_scope.go`) already
// writes only the agreeing shapes today, so no currently-served response
// changes disposition. It closes a validation GAP (a response this
// consumer would have accepted with a self-contradictory census row),
// verified with the pin: `authorized_population_count: 0` beside
// `population_measured: false` (and the symmetric `null` beside `true`)
// now fails schema validation where it silently passed before.
export const SOURCE_COMMIT = "d949d18cb41b8970867eaf31b0bde48710d35956";

const PRETTIER_OPTIONS = Object.freeze({
    parser: "typescript",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    tabWidth: 4,
    trailingComma: "all",
    useTabs: false,
});

// The consumed surface, and nothing beyond it. `context_fabric_common` is the
// $ref closure of the other three; the examples are the canonical vocabulary
// the mock fixtures are derived from.
const SCHEMA_PATHS = [
    "contracts/jsonschema/v1/context_fabric_common.v1.schema.json",
    "contracts/jsonschema/v1/context_fabric_investigation_request.v1.schema.json",
    "contracts/jsonschema/v1/context_fabric_investigation_result.v1.schema.json",
    "contracts/jsonschema/v1/error.v1.schema.json",
];
const EXAMPLE_PATHS = [
    "contracts/examples/v1/context_fabric_investigation_request.v1.json",
    "contracts/examples/v1/context_fabric_investigation_result.v1.json",
    // CHAOS-4415: the render-shape example. Added because the workbench's
    // chart tests must run against a document acr's OWN producer emitted --
    // a hand-authored fixture would pass a renderer test while the live
    // shape differed. The pre-4415 result example above carries a cohort
    // under a single_subject interpretation and therefore no shapes at all,
    // which is exactly why it cannot serve as this one.
    "contracts/examples/v1/context_fabric_investigation_result_render_shapes.v1.json",
    "contracts/examples/v1/error_context_fabric_interpretation_rejected.v1.json",
];
export const SOURCE_PATHS = [...SCHEMA_PATHS, ...EXAMPLE_PATHS];

// Each schema compiles to its OWN module with its full $ref closure declared
// inline. Separate modules, not one bundle: two schemas that both reference
// `SubjectRef` would otherwise emit two colliding declarations in one file.
const GENERATED_MODULES = [
    {
        artifact: "generated/investigation-result.ts",
        schema: "context_fabric_investigation_result.v1.schema.json",
        typeName: "ContextFabricInvestigationResult",
    },
    {
        artifact: "generated/investigation-request.ts",
        schema: "context_fabric_investigation_request.v1.schema.json",
        typeName: "ContextFabricInvestigationRequest",
    },
    {
        artifact: "generated/error.ts",
        schema: "error.v1.schema.json",
        typeName: "AcrError",
    },
];

const GENERATED_BANNER =
    "/* eslint-disable */\n" +
    "/**\n" +
    " * GENERATED by scripts/sync-acr-contracts.mjs. DO NOT EDIT.\n" +
    ` * Source: full-chaos/dev-health-acr @ ${SOURCE_COMMIT}\n` +
    " * Regenerate with `pnpm acr:contracts:generate --source <acr worktree>`.\n" +
    " */\n\n";

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function artifactPath(sourcePath) {
    if (sourcePath.startsWith("contracts/jsonschema/v1/")) {
        return `schemas/${path.basename(sourcePath)}`;
    }
    if (sourcePath.startsWith("contracts/examples/v1/")) {
        return `examples/${path.basename(sourcePath)}`;
    }
    throw new Error(`unexpected source path: ${sourcePath}`);
}

function git(args, cwd) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
    return result.stdout;
}

/**
 * Reads the pinned blobs out of a clean acr worktree whose HEAD equals the pin.
 *
 * The worktree must be clean and parked ON the pin: reading `git show
 * <commit>:<path>` from a dirty or differently-parked tree still returns the
 * right bytes, but it lets a human believe they verified a tree they did not,
 * so it is rejected rather than tolerated.
 */
function readPinnedSourceFiles(sourceRoot) {
    const resolvedRoot = fs.realpathSync.native(sourceRoot);
    if (git(["rev-parse", "--show-toplevel"], resolvedRoot).trim() !== resolvedRoot) {
        throw new Error("source must be a Git worktree root");
    }
    const head = git(["rev-parse", "--verify", "HEAD^{commit}"], resolvedRoot).trim();
    if (head !== SOURCE_COMMIT) throw new Error(`source HEAD must equal ${SOURCE_COMMIT}`);
    if (git(["status", "--porcelain"], resolvedRoot).trim() !== "") {
        throw new Error("source worktree must be clean");
    }
    return SOURCE_PATHS.map((sourcePath) => ({
        path: sourcePath,
        contents: git(["show", `${SOURCE_COMMIT}:${sourcePath}`], resolvedRoot),
    }));
}

/** Reads the committed copies back and verifies each against the manifest digest. */
function readCommittedSourceFiles() {
    const manifestPath = path.join(ARTIFACT_ROOT, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("committed artifacts are missing");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.source_commit !== SOURCE_COMMIT) {
        throw new Error(`manifest pins ${manifest.source_commit}, expected ${SOURCE_COMMIT}`);
    }
    const digests = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
    return SOURCE_PATHS.map((sourcePath) => {
        const relative = artifactPath(sourcePath);
        const contents = fs.readFileSync(path.join(ARTIFACT_ROOT, relative), "utf8");
        if (sha256(contents) !== digests.get(relative))
            throw new Error(`digest drift: ${relative}`);
        return { path: sourcePath, contents };
    });
}

/**
 * CHAOS-3927 P1 (acr 7d275c2e): `WindowOption`'s schema carries
 * `allOf`/`anyOf`/`not` frozen-bounds conditionals (design brief §5.1)
 * alongside its `properties`. json-schema-to-typescript renders those as
 * index-signature intersections it cannot merge into a plain object shape,
 * and instantiating THAT inside a `maxItems`-bounded array
 * (json-schema-to-typescript renders `maxItems` as a union of fixed-length
 * tuples) exceeds TypeScript's own type-complexity budget (`TS2590`) —
 * reliably, even for a two-element literal array.
 *
 * Fixed by dropping `WindowOption`'s three conditional keywords from the
 * TYPE-GENERATION copy of the schema ONLY — never from the copy committed
 * to `src/contracts/schemas/`, which stays byte-identical to the pinned
 * commit's own blob (verified against it by `check --source`) and is what
 * `validateContract` actually runs at request/response time. The frozen-
 * bounds invariant those keywords express (a non-`all_time` option's
 * `start`/`end` must both be present, `all_time` forbids both) was never
 * something `json-schema-to-typescript` could express as a TS type either
 * way (conditional validation isn't representable as a structural type) —
 * dropping it from the TYPE only removes redundant intersection noise the
 * compiler was already unable to use, not an invariant TypeScript was
 * actually enforcing. `codex round 1` (an earlier version of this fix used
 * `ignoreMinAndMaxItems` globally, which also erased real minItems-only
 * "non-empty array" tuple types — `affected_subjects`, `match_reasons`,
 * etc. — on fields this bug has nothing to do with; scoped to the one
 * schema that actually needs it instead).
 */
function stripWindowOptionConditionalsForTypeGeneration(schemaDirectory) {
    const commonSchemaPath = path.join(schemaDirectory, "context_fabric_common.v1.schema.json");
    const schema = JSON.parse(fs.readFileSync(commonSchemaPath, "utf8"));
    const windowOption = schema.$defs?.WindowOption;
    if (windowOption === undefined) throw new Error("WindowOption $def not found — pin drifted?");
    delete windowOption.allOf;
    delete windowOption.anyOf;
    delete windowOption.not;
    fs.writeFileSync(commonSchemaPath, JSON.stringify(schema));
}

/**
 * `unknownAny: false` still leaves `any` in the compiled declarations (the
 * option only controls what `$ref`-less unknowns render as), so this widens
 * every literal `any` TYPE to `unknown` -- but a blind `\bany\b` replace over
 * the WHOLE declarations string also hits the JSDoc comments
 * json-schema-to-typescript renders from each schema's own `description`
 * text, corrupting prose that happens to use the English word "any" (codex
 * review round 1, r1: CHAOS-5405's own `fact_scope_census` description reads
 * "on any path that resolved no scope at all", rendered here as "on unknown
 * path" -- nonsensical, and not even a type-widening the source has any
 * business narrating). Scoped to skip `/** ... *‍/` blocks AND quoted string
 * literals (single- or double-quoted, escape-aware) -- a JSON Schema `enum`
 * member or `const` whose own VALUE is the word "any" renders as a quoted
 * TypeScript string-literal type, and an outer replace that only excluded
 * comments would still corrupt that literal's actual runtime value (codex
 * review round 2, r2: `type X = "any"` -> `type X = "unknown"`, silently
 * wrong for a value the compiled type no longer matches). Splitting on both
 * comments and string literals and only replacing in what is left between
 * them is exactly where a bare `any` TYPE token can appear.
 */
function replaceAnyTypeOutsideCommentsAndStrings(declarations) {
    const preserved = /(\/\*\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gu;
    return declarations
        .split(preserved)
        .map((chunk, index) => (index % 2 === 0 ? chunk.replace(/\bany\b/gu, "unknown") : chunk))
        .join("");
}

/**
 * Compiles one schema to a module. json-schema-to-typescript resolves the
 * cross-file `$ref`s against `cwd`, which is why the copies must already be on
 * disk before this runs.
 */
async function generatedModules(schemaDirectory) {
    stripWindowOptionConditionalsForTypeGeneration(schemaDirectory);
    const modules = {};
    for (const entry of GENERATED_MODULES) {
        const schema = JSON.parse(
            fs.readFileSync(path.join(schemaDirectory, entry.schema), "utf8"),
        );
        const declarations = await compile(schema, entry.typeName, {
            bannerComment: "",
            cwd: `${schemaDirectory}${path.sep}`,
            declareExternallyReferenced: true,
            format: false,
            strictIndexSignatures: true,
            unknownAny: false,
        });
        modules[entry.artifact] = await format(
            GENERATED_BANNER + replaceAnyTypeOutsideCommentsAndStrings(declarations),
            PRETTIER_OPTIONS,
        );
    }
    return modules;
}

function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Every artifact this repo should contain, keyed by its path under
 * src/contracts. Both `generate` and `check` build this same map; they differ
 * only in whether they write it or diff it.
 */
async function expectedArtifacts(sourceFiles) {
    const copies = Object.fromEntries(
        sourceFiles.map((file) => [artifactPath(file.path), file.contents]),
    );
    // Types are derived from the COPIES, not from the acr worktree, so `check`
    // proves the committed types match the committed schemas even with no acr
    // checkout in reach.
    const schemaDirectory = fs.mkdtempSync(path.join(ROOT, ".acr-contract-types-"));
    let modules;
    try {
        for (const [relative, contents] of Object.entries(copies)) {
            if (!relative.startsWith("schemas/")) continue;
            fs.writeFileSync(path.join(schemaDirectory, path.basename(relative)), contents);
        }
        modules = await generatedModules(schemaDirectory);
    } finally {
        fs.rmSync(schemaDirectory, { force: true, recursive: true });
    }
    return {
        ...copies,
        ...modules,
        "manifest.json": stableJson({
            source_commit: SOURCE_COMMIT,
            source_repository: "full-chaos/dev-health-acr",
            files: Object.keys(copies)
                .sort()
                .map((relative) => ({ path: relative, sha256: sha256(copies[relative]) })),
        }),
    };
}

function artifactDestination(relative) {
    const destination = path.resolve(ARTIFACT_ROOT, relative);
    if (destination !== path.join(ARTIFACT_ROOT, relative)) throw new Error("unsafe artifact path");
    return destination;
}

function writeArtifacts(artifacts) {
    for (const [relative, contents] of Object.entries(artifacts)) {
        const destination = artifactDestination(relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, contents);
    }
}

function removeStaleArtifacts(expected) {
    for (const directory of ["schemas", "examples", "generated"]) {
        const directoryPath = path.join(ARTIFACT_ROOT, directory);
        if (!fs.existsSync(directoryPath)) continue;
        for (const entry of fs.readdirSync(directoryPath)) {
            const relative = `${directory}/${entry}`;
            if (!expected.has(relative)) fs.rmSync(artifactDestination(relative));
        }
    }
}

function assertCurrent(artifacts) {
    for (const [relative, expected] of Object.entries(artifacts)) {
        const destination = artifactDestination(relative);
        if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== expected) {
            throw new Error(`artifact drift: ${relative} (run pnpm acr:contracts:generate)`);
        }
    }
    const expectedPaths = new Set(Object.keys(artifacts));
    for (const directory of ["schemas", "examples", "generated"]) {
        const directoryPath = path.join(ARTIFACT_ROOT, directory);
        if (!fs.existsSync(directoryPath)) continue;
        for (const entry of fs.readdirSync(directoryPath)) {
            if (!expectedPaths.has(`${directory}/${entry}`)) {
                throw new Error(`unexpected artifact: ${directory}/${entry}`);
            }
        }
    }
}

function parseArguments(argumentsList) {
    const [mode, ...rest] = argumentsList;
    if (mode !== "generate" && mode !== "check") throw new Error("use generate or check");
    let source = process.env.ACR_ROOT;
    let allowWrite = false;
    for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === "--allow-write") {
            allowWrite = true;
            continue;
        }
        if (rest[index] !== "--source") throw new Error(`unknown argument: ${rest[index]}`);
        source = rest[index + 1];
        if (source === undefined) throw new Error("--source requires a value");
        index += 1;
    }
    return { allowWrite, mode, source };
}

async function main() {
    const { allowWrite, mode, source } = parseArguments(process.argv.slice(2));
    if (mode === "generate") {
        if (source === undefined) throw new Error("generate requires ACR_ROOT or --source");
        if (!allowWrite) throw new Error("generate requires --allow-write");
        const artifacts = await expectedArtifacts(readPinnedSourceFiles(path.resolve(source)));
        writeArtifacts(artifacts);
        removeStaleArtifacts(new Set(Object.keys(artifacts)));
        process.stdout.write(`Generated ACR contract artifacts from ${SOURCE_COMMIT}.\n`);
        return;
    }
    const sourceFiles =
        source === undefined
            ? readCommittedSourceFiles()
            : readPinnedSourceFiles(path.resolve(source));
    assertCurrent(await expectedArtifacts(sourceFiles));
    process.stdout.write("ACR contracts are current.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(
            `ACR contract sync failed: ${error instanceof Error ? error.message : "unexpected failure"}\n`,
        );
        process.exitCode = 1;
    });
}
