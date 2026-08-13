# Ask Dev Workbench

Temporary frontend for the ACR **Context Fabric**: ask a question, read the
investigation result.

Tracked as **CHAOS-3803**.

## What this is, and what it is not

The workbench is a **read-only consumer**. It renders an investigation result
exactly as the service produced it. It authors no facts, no metrics, no health
states, and no authorization decisions — that boundary is CHAOS-3738, and it is
the reason this repo has no server, no database, and no write path.

It is also **temporary**. It exists so the Context Fabric result shape can be
looked at and argued about before the surface has a permanent home. Two futures
are expected, and the code is written for either:

- the components migrate into `dev-health-web`, or
- this becomes a separate entry point of its own.

Both are served by the same rule: **stay portable**. React + TypeScript, minimal
dependencies, no framework lock beyond React. There is no router, no state
library, no CSS framework, and no server runtime to unpick later.

## Current scope (scaffold)

The app answers from **committed mock fixtures**, not a live service. The
fixtures are derived from the pinned ACR contract examples and validated against
the pinned JSON Schemas in the unit suite.

Rendered today:

- the answer — `deterministic_answer`, `direct_judgment`, `current_state`,
  strongest pressures, and drivers;
- **coverage** — every source with its contract state, including `pruned`,
  `unauthorized`, and `no_data`, plus `partial` and `degraded_reasons`;
- **limitations** and warnings;
- **subject resolution** — committed subjects, and the candidates the service
  could not choose between, with its own clarification prompt;
- **evidence references** — the `evidence_ref_ids` verbatim, per driver, per
  finding, per candidate, and for the result as a whole;
- provenance — the full `versions` block.

Not yet wired: any live call. `VITE_ASK_DEV_API_BASE_URL` is read by
`src/config.ts` but unused.

## Running it

```sh
pnpm install
pnpm dev            # http://127.0.0.1:5180
```

Configuration is build-time only. Copy `.env.example` to `.env.local` (git
ignored) to override. No `.env` is committed, no endpoint is hardcoded, and no
credential belongs in a `VITE_*` variable — Vite inlines them into the public
bundle.

## Gates

`ci/run_checks.sh` is the single entry point. CI runs the same tiers a developer
runs locally, so a green local run means a green CI run.

```sh
bash ci/run_checks.sh ci          # everything, in CI order
bash ci/run_checks.sh format      # prettier --check
bash ci/run_checks.sh contracts   # exact-diff contract regeneration guard
bash ci/run_checks.sh lint
bash ci/run_checks.sh typecheck
bash ci/run_checks.sh unit
bash ci/run_checks.sh build
bash ci/run_checks.sh e2e         # Playwright smoke over the BUILT artifact
```

Workflows: `tests.yml` (the gates above), `codeql-analysis.yml`, and
`security-scan.yml` (Gitleaks + `pnpm audit`). Gitleaks is a hard gate here —
this repo starts with clean history, so an allowed-to-fail secret scan would be
a dead guard. It needs the organization's `GITLEAKS_LICENSE` secret to be
visible to this repository.

## Contract pin

The ACR contract surface is **copied**, not fetched, from a pinned commit of
`full-chaos/dev-health-acr`. The copies and everything derived from them live
under `src/contracts/` and are **never hand-edited** — `scripts/sync-acr-contracts.mjs`
is their only author.

```
src/contracts/
  schemas/      exact copies of the pinned JSON Schemas
  examples/     exact copies of the pinned canonical examples
  generated/    TypeScript types compiled from the copies
  manifest.json the pinned commit + a sha256 per copied file
```

`pnpm acr:contracts:check` recomputes every artifact and fails on the first byte
of drift. It needs no acr checkout: it verifies the copies against the manifest
digests and regenerates the types from them. That catches a hand-edited copy, a
hand-edited generated type, and a stale type after a pin bump.

Import the types through `src/lib/contracts.ts`, never from
`src/contracts/generated/` directly. The generated identifiers come from the
schemas' `title` fields and change with the contracts; that file is the one
place a rename has to be absorbed.

### Bumping the pin

1. Park a clean `dev-health-acr` worktree on the new commit
   (`git -C <acr> status --porcelain` must be empty — the sync script refuses a
   dirty or differently-parked tree).
2. Set `SOURCE_COMMIT` in `scripts/sync-acr-contracts.mjs` to the **full
   40-character** SHA.
3. Regenerate and verify against the source:
    ```sh
    pnpm acr:contracts:generate --source /path/to/acr
    pnpm acr:contracts:check --source /path/to/acr
    ```
4. Run the gates. `bash ci/run_checks.sh ci`.
5. Read the diff of `src/contracts/`. A changed enum is a UI change: the tone
   maps in `src/lib/presentation.ts` are exhaustive over the closed vocabularies
   and `src/lib/presentation.test.ts` reads those enums straight out of the
   pinned schema, so a new state fails the suite instead of rendering blank.

Currently pinned: `0ed4e1ae7fdbb4e7e121b20d733f2ff8fd516e1c` (acr main,
CHAOS-3783).

## Mock fixtures

`src/mocks/investigations.ts` holds four scenarios: `complete` (the canonical
example, unmodified), `degraded`, `clarification`, and `no-match`.

Every scenario is a structural clone of the pinned canonical example with named
fields overridden. **Mocks mirror the real vocabulary — nothing is invented.**
Values come from the contract's own closed enums, or from strings the ACR
service itself emits (`canonical_fact:<kind>` source names, the
`pruned:subject_kind_unsupported: …` prune reason, `"<fact kind>: <reason>"`
degraded entries, `endpoint_lookup_failed:<n>`).

`src/mocks/investigations.test.ts` validates every scenario against the pinned
schemas, and carries the negative controls that make that validation mean
something: an invented coverage state, a missing required field, and an invented
subject-candidate state must all be rejected.

> There is no `retrieval_degraded` coverage state. That term appears nowhere in
> the ACR contracts or service. The contract expresses degraded retrieval as
> `coverage.partial: true` plus `coverage.degraded_reasons[]`, alongside the
> real states (`stale`, `unavailable`, `truncated`, `pruned`, …) — which is what
> the `degraded` scenario uses.

## Styling

One stylesheet, `src/styles.css`, plain class names, CSS custom properties, dark
by default with a light `prefers-color-scheme` block.

**Hard rule: no bright borders on the dark theme.** Separation comes from
surface elevation and low-alpha hairlines, never from a light outline on a dark
ground.
