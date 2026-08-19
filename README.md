# Context Fabric Workbench

Standalone answer test platform for the ACR **Context Fabric**: ask a question,
inspect both the intelligence and its presentation.

Tracked as **CHAOS-3738** (repo scaffolded under CHAOS-3803).

## What this is, and what it is not

The Workbench lets an authorized tester ask Context Fabric the real product
questions and inspect the answer **and** its presentation, without depending on
the legacy Ask Dev path or its UX. It is platform/test scoped until the Context
Fabric beta gate passes, and is explicitly **separate from the Ask Dev window
and `/dev`**.

It is a **read-only consumer**. It authors no facts, metrics, health states,
drivers, evidence, scope, or authorization. Its only write-shaped interaction is
asking a question.

It **calls the real ACR investigation API**. It does not consume mock
investigation results — fixtures exist only inside unit tests, and a lint rule
fails the build if product code imports one.

The manifest, component library, and interaction model are meant to be promoted
into Ask Dev later, so portability is a standing constraint: React + TypeScript,
minimal dependencies, and the same Next.js version `dev-health-web` runs.

## The three views

One immutable result, three views (CHAOS-3738):

1. **Canonical result inspector** — the complete ACR result with structure
   unhidden: resolved subjects and bound receipts, analytical goal and scope,
   cohort membership with inclusion/exclusion rationale, relationship and
   evidence paths, canonical facts, coverage and limitations, every version
   stamp, and the raw contract payload.
2. **Deterministic answer view** — the reference answer and the fallback,
   rendered by a native component set with no model involved.
3. **OpenUI enrichment view** — _not yet built_ (M3). It will be driven by a
   Dev Health-owned, reference-only presentation manifest and a closed component
   library, validated in full before rendering and failing closed to the
   deterministic view.

The raw and deterministic views stay available beside the enriched one, so
presentation can never mask an answer-quality failure.

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

## Running it

```sh
pnpm install
pnpm dev            # http://127.0.0.1:3000
```

The Workbench needs a configured server hop before it can answer. Without one it
still runs and says so — it has no mock path, so an unconfigured server reports
`workbench_misconfigured` rather than inventing an answer.

| Variable                     | Required | Purpose                                     |
| ---------------------------- | -------- | ------------------------------------------- |
| `ACR_API_ORIGIN`             | yes      | ACR base URL, e.g. `http://127.0.0.1:18080` |
| `ACR_ORG_ID`                 | yes      | Organization to investigate as              |
| `ACR_WEB_ASSERTION_KEY_FILE` | yes      | **Path** to the Ed25519 signing key         |
| `ACR_REPOSITORY_SCOPES`      | yes      | Comma-separated `owner/name` slugs          |
| `ACR_WEB_ASSERTION_ISSUER`   | no       | Default `dev-health-web`                    |
| `ACR_WEB_ASSERTION_AUDIENCE` | no       | Default `dev-health-acr`                    |
| `ACR_WEB_ASSERTION_KID`      | no       | Default `acr-dev-web`                       |
| `ACR_SUBJECT`                | no       | Default `context-fabric-workbench`          |
| `ACR_TIMEOUT_MS`             | no       | Default `120000`                            |

No `.env` is committed and no endpoint is hardcoded. The signing key is
referenced **by path** and never enters this repo. Nothing is `NEXT_PUBLIC_*`,
so no ACR value can reach the browser bundle.

## Why there is a server

Both ACR credentials are server-to-server by construction: `bearerAuth` is a
client secret, and `webAssertionAuth` requires signing each request with an
Ed25519 **private** key, bound to the exact method, path, and body digest, with
a 30-second lifetime. A browser cannot hold either. `src/app/api/investigations`
is the hop that signs and forwards; it mirrors `dev-health-web`'s server-only
ACR client so the code ports cleanly when this surface migrates.

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

The smoke suite runs with **no** ACR configuration on purpose. The Workbench has
no mock path, so the only honest thing it can do unconfigured is say so — and
proving that a failure presents as a failure, never as a thin answer, is exactly
what that suite is for.

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

### Why Next.js is pinned exactly

`next` is pinned to `16.2.12`, not `^16.2.12`. A fresh caret install resolves to
16.3.x, which `dev-health-web` is deliberately paused on over open regressions.
This surface is meant to be promoted into that repo, so it should run what that
repo runs. Bump it when web bumps, not before.

## ACR integration notes

Things worth knowing before touching the client, learned against the live
service rather than from documentation:

- **A rejected server credential surfaces as 502, not 401.** The server hop
  holds the ACR credential, so an ACR rejection says nothing about the browser
  session. Proxying it as 401 would invite a client-side re-auth that cannot
  possibly help.
- **`repository_scopes` must not be empty.** `validWebRepositories` in acr
  `internal/auth/web_assertion_binding.go:34-37` opens with
  `if len(scopes) == 0 { return false }`, and the whole assertion then fails as
  `invalid_web_assertion` — reaching the caller as a bare `401 invalid_token`
  that says nothing about scopes. `dev-health-web` never trips this because its
  scopes always come from a resolved org authorization. `signWebAssertion`
  guards it locally so a new consumer gets a named error instead. Recorded as an
  observation, not a patch: acr is not this repo's to change, and failing closed
  on an empty scope set may well be deliberate.
- **TLS is ON by default for the graph dial, and `ALLOW_INSECURE` does not turn
  it off.** `ACR_CONTEXT_FABRIC_FALKOR_TLS` defaults to true while
  `ACR_CONTEXT_FABRIC_FALKOR_ALLOW_INSECURE` only relaxes certificate
  _validation_. Against a plaintext FalkorDB port the dial TLS-handshakes and
  hangs until a timeout, so an authenticated investigation reaches the engine
  and dies there — presenting as a slow, generic timeout rather than a
  connection error. Set `ACR_CONTEXT_FABRIC_FALKOR_TLS=false` for a plaintext
  local backend.
- **A 503 from the investigations route is usually an operator state, not a
  blip.** ACR serves a static 503 when the investigator is not composed, which
  needs three independent things: `ACR_CONTEXT_FABRIC_GRAPH_READS_ENABLED`, a
  configured graph backend (`ACR_CONTEXT_FABRIC_FALKOR_ADDR`, with the
  `context-fabric-graph` compose profile up), and a configured model provider.
- **A 504 is not an unreachable service.** ACR's global `ACR_REQUEST_TIMEOUT`
  defaults to 15s while its model call budget defaults to 45s, so a real
  model-backed investigation can exhaust the HTTP budget while the pipeline is
  still running. The Workbench reports that as `acr_timeout`, separately from
  `acr_unreachable`, because the two lead to different investigations.
- **ACR's status codes are a deliberate classification — read them literally.**
  `422 interpretation_rejected` / `synthesis_rejected` is ACR's own validator
  rejecting an artifact it derived (a classified non-answer, retryable);
  `502 upstream_invalid_output` is the provider misbehaving; `503` is a
  dependency down; `429` is rate limiting. **`500 internal_error` is the
  unclassified fallthrough** — `context_fabric_routes.go` says in as many words
  that a bound violation "is not the provider misbehaving (that stays 502) and
  not an ACR bug (that stays 500)". So a 500 here means an ACR-side fault, not a
  model being picky, and retrying it will not help — ACR itself marks it
  `retryable: false`.
- **An investigation is not guaranteed to answer on the first call, and the
  Workbench deliberately does NOT auto-retry.** ACR's own operations guide is
  explicit that `422 interpretation_rejected`, `422 synthesis_rejected`, and
  `502 upstream_invalid_output` are expected, retryable outcomes even with the
  fallback model configured. A product client should probably retry; this one
  must not. Its whole purpose is measuring answer quality, and silently
  re-rolling until something succeeds would hide the rejection rate — the exact
  number a tester is here to see. The outcome is surfaced with its retryable
  flag and the tester decides.
- **A 5xx is not an unreachable service either.** ACR deliberately keeps the
  underlying reason for an engine failure off the wire, so the Workbench reports
  `acr_investigation_failed` and surfaces **ACR's own `request_id`** — the only
  handle for matching the failure against ACR's logs. It never guesses a cause.
- **The graph key is derived, not literal.** Reader and projector both call
  `graphKey(prefix, orgID)`, so the live graph is `acr-cf-<hash>`, not
  `acr-cf-<org-uuid>`. An empty `acr-cf-<org-uuid>` key in FalkorDB is a leftover
  and is not the graph being read.

## Test fixtures

`src/test/fixtures/investigations.ts` holds four scenarios: `complete` (the
canonical example, unmodified), `degraded`, `clarification`, and `no-match`.

**These are test inputs only and may never be presented as answers.** An ESLint
`no-restricted-imports` rule fails the build if anything under `src/app`,
`src/components`, or `src/lib` imports them.

Every scenario is a structural clone of the pinned canonical example with named
fields overridden. **Mocks mirror the real vocabulary — nothing is invented.**
Values come from the contract's own closed enums, or from strings the ACR
service itself emits (`canonical_fact:<kind>` source names, the
`pruned:subject_kind_unsupported: …` prune reason, `"<fact kind>: <reason>"`
degraded entries, `endpoint_lookup_failed:<n>`).

`src/test/fixtures/investigations.test.ts` validates every scenario against the pinned
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

## Length bounds count Unicode code points

**The invariant, stated once:** every length bound in this repo counts **Unicode
code points**, because ACR counts runes (Go's `RuneCountInString`) and that is
also what JSON Schema's `maxLength` means. JavaScript's `.length` counts UTF-16
units, so an astral character counts twice — a question of exactly 8000 astral
code points measures 16000 and would be rejected by a naive guard that ACR would
have accepted.

Three idioms enforce it, and they are deliberately **not** unified behind one
helper — consistency of _behaviour_ is the invariant, consistency of _idiom_ is
aesthetics:

| Where                                 | Idiom                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/investigations/route.ts` | `codePointLength` (spread) — question and receipt ids                                                                           |
| `src/lib/acr/upstream-vocabulary.ts`  | `u`-flagged regex quantifier — its `{1,128}` counts code points because of the flag, and it does charset and length in one pass |
| `src/lib/acr/validate.ts` (Ajv)       | `ucs2length` — verified by probing the pinned dependency, not by reading docs                                                   |

Byte bounds are a separate thing and are measured in bytes
(`exceedsResponseCap`), not in either character unit.

If you add a length bound, count code points, and add an **astral boundary
test** — a correct fix with only ASCII fixtures is indistinguishable from a fix
never made, which is how the receipt bound sat unpinned through a review round.

## Silent-discard class closure

Five instances of one shape appeared during CHAOS-3738 — the Workbench
presenting a state as normal when something was silently discarded or
substituted. `src/lib/silent-discard-closure.test.ts` closes the class rather
than chasing a sixth: it enumerates every seam where a result or user input
crosses a boundary, with a verdict of **structurally impossible** (mechanism
named), **detected and surfaced**, or **accepted gap** (real owner).

**15 seams; 2 accepted gaps**, both owned — CHAOS-3813's missing wire signal,
and ACR stage latency (the spec asks for it and ACR exposes none, so it is
recorded as total and labelled rather than apportioned by guess). The gap list
is deliberately non-empty: a table whose every row read "impossible" would be
the same fails-toward-fine shape it exists to close.

Those counts are asserted in the test, by exact gap name and exact seam count —
the artifact once carried different numbers from the README and from a status
report, and three numbers in three places was itself a finding. Drift now fails
the suite instead of waiting for someone to count rows.

One row carries a **precondition** rather than a gap: model-authored
compositions do not exist yet (the only producer is `buildComposition`), so the
seam is unreachable. That inventory is **enforced rather than asserted** —
`producer-inventory.test.ts` scans the source and requires the producer set to
be exactly `[buildComposition]`, so adding a model-authored producer fails that
test, and the failing test _is_ the re-verdict trigger the precondition
promises.

The recurring reason these hid: every one produced output that _looked_ like
ordinary safe operation. Falling back looks safe. An empty section looks like
"nothing to report". A fresh clarification looks like a fresh question.

## Clarification: the disambiguation flow

When ACR cannot commit a subject it returns `clarification_required` with ranked
candidates, and the tester chooses one. Four rules hold this path honest:

1. **A clarification is not a failed answer**, and is not rendered as a thin
   one. The choice leads; empty judgment panels do not appear above it.
2. **The choice travels as ACR's own `receipt_id`**, through the contract's
   `prior_subject_receipts`, never as a re-typed subject name. The Workbench
   therefore never names or authorizes a subject on a tester's behalf, and the
   UI can only offer candidates the result already contains.
3. **The question is re-sent unchanged.** Rewriting it to mention the chosen
   subject would make the Workbench author part of the question, and ACR would
   then be answering something the tester never asked.
4. **Candidate order is ACR's.** Re-sorting by confidence would be the
   presentation layer quietly forming a judgment ACR did not make.

Receipts are deduplicated and capped at the contract's `maxItems` of 20 before
being sent. A receipt arriving from the browser that is malformed **rejects the
request** rather than being filtered out of it: a discarded receipt would mean
the re-ask ran without the chosen subject, and the tester would get a fresh
clarification with no sign their choice was thrown away.

Identity is ACR's to enforce, and it does — verified at pin `0ed4e1a` that the
result lookup is org-scoped in SQL (`pginvestigation/store.go:202-203`) and that
a receipt must match a candidate of that same result (`engine.go:404-414`). The
route validates shape only.

**ACR discards a receipt silently** when the prior result is unreadable, no
candidate matches, or the subject is unauthorized — `engine.go:417-427` states
that "Investigate itself never errors or otherwise surfaces the skip", and the
result schema carries no receipt disposition. So the Workbench **detects** it:
after a re-ask, the chosen subject is compared against `subject_resolution.committed`
by canonical id, and a mismatch is reported in both shapes — an answer about
another subject, and a second clarification that would otherwise let a tester
loop forever.

That detection is **kept after CHAOS-3813 lands** acr-side. Once ACR reports a
per-receipt disposition on the wire this check becomes redundant, and it stays:
defense in depth on a measurement instrument is not dead code, and a future pin
bump should not delete it as such.

## Structure hints: the pivot-intent panel (CHAOS-3927 P2)

The pivot-intent design brief (dev-health `.remember/pivot-intent-design-brief.md`,
DESIGN-FINAL) names ask-dev the panel surface of record (DP6(c)) for a new
disclosure block, `structure_needs`: when ACR cannot even settle which census
to run, it can name WHICH intent-frame members are missing (kind, anchor,
handle, window) and offer typed, receipt-bound completions for each, instead
of a dead-end refusal. `StructureNeedsPanel` renders exactly those offers,
`StructureConfirmationNotice` renders the `confirmed_structure` echo
(including vetoed selections — the silent-drop closure for structure, day
one, unlike the subject-receipt path above). Both extend the disambiguation
flow's own rules verbatim: receipts only, never re-ranked, never invented,
free text never becomes a discriminator.

**PENDING-P1.** `structure_needs` does not exist on the pinned acr contract —
P1 (the acr-side substrate, CHAOS-3927/CHAOS-3900) is mid-build on a separate
branch, not yet merged to acr `main`, so there is nothing to sync via
`scripts/sync-acr-contracts.mjs` yet. This slice is built against
schema-derived fixtures instead: `src/lib/pivot/structure-contracts.ts`
hand-mirrors the P1 lane's own committed Go types and JSON Schema `$defs`
field-for-field (paths and commit cited in that file's header), and
`src/lib/pivot/structure-needs.pending-p1.schema.json` is a staging copy of
the relevant `$defs`, used only to validate this repo's own fixtures
(`src/test/fixtures/structure-needs.ts`) — never a real ACR response.
Neither file lives under `src/contracts/` and neither is touched by the sync
script or its drift check.

**The integration seam** is one function: `buildInvestigationRequest` in
`src/lib/acr/client.ts` accepts the four new `prior_*_receipts` fields but
attaches them to the outbound wire object **only when non-empty**. Since ACR
never emits `structure_needs` today, `StructureNeedsPanel` can never produce
a selection in real use, so these arrays are always empty and the wire
payload this function builds is byte-identical to before this change —
proven in `client.test.ts`. Once P1 (+ CHAOS-3900 W1, window) merge to acr
`main` and this repo's pin bumps past that merge, the regenerated
`InvestigationRequest`/`InvestigationResult` types will declare these fields
themselves; `structure-contracts.ts`'s header ("THE SEAM") lists the small,
mechanical set of import changes that migration is — no other file changes.

Testing note: this repo has no real e2e mock path (see "What this is, and
what it is not" above), so the closest thing to an end-to-end proof of the
panel-hint flow is `src/app/page.test.tsx`'s `structure-needs panel hints`
suite — the real page component driven against a schema-shaped mock `fetch`
response, same discipline the clarification flow's own page tests already
use.

## Enrichment (M3, not yet wired live)

`src/lib/enrichment/` holds the pieces the enriched view will sit on. The tab
stays **disabled** until a real answer renders in the deterministic view and
every validator predicate test is green.

- **`manifest.ts`** — the Dev Health-owned presentation manifest. It declares
  the closed component set, which props are _material_, the closed vocabularies
  for the rest, and the mandatory sections. It carries no answer, fact, metric,
  or judgment; only headings and layout vocabulary. **The manifest, not OpenUI,
  is the product boundary.**
- **`library.tsx`** — the closed component library. Every renderer takes no
  `className`, `style`, `href`, or `src`, declares no action, and renders text
  as a React text child, never through `dangerouslySetInnerHTML`.
- **`refs.ts`** — reference-only resolution. A material prop may never be a
  literal; it must be a `@result.` reference resolved against the immutable
  result. Only own properties and integer array indices resolve, and only to
  scalars, so `@result.constructor`, `@result.__proto__.x`, and
  `@result.limitations.length` all fail.
- **`validate.ts`** — the fail-closed validator. It parses the WHOLE
  composition and checks every predicate before anything mounts, because
  OpenUI's renderer is progressive by design: left to itself it drops the
  offending node and renders the rest.

Two predicates exist because of behaviour observed in a probe, not because the
documentation suggested them — and a validator without them would have shipped
holes. Both depend on **undocumented** fields of OpenUI's `ParseResult`
(`meta.unresolved`, and the `hasDynamicProps` flag on a parsed node), so the
dependency is named here deliberately: a future OpenUI version could rename
either. The predicate tests assert the violation is _produced_, so a rename
fails the suite loudly rather than silently disabling the check.

1. `meta.unresolved` is populated while `meta.errors` stays **empty** for a
   dangling reference. Checking only `errors` passes a composition that
   references nothing.
2. Built-in functions (`@Count(...)`) and `$state` variables raise **no error**;
   they appear only as nodes flagged `hasDynamicProps`. That flag is the tell
   for a model-computed value, which the spec forbids outright.

Each predicate has a hostile payload in `validate.test.ts`, plus a passing
control — without one, a validator that rejected everything would look perfect.

## OpenUI

`@openuidev/react-lang` (caged renderer) and `@openuidev/react-headless` (chat
hooks) will be adopted in M3. `@openuidev/react-ui` was evaluated and
**deliberately excluded**: it pulls roughly twenty extra dependencies including
sixteen Radix packages and its own design system, and it contains the only two
things in that codebase we must not ship — a `dangerouslySetInnerHTML` and a
`window.open`. Please do not add it back.

OpenUI is a **replaceable adapter**. The enrichment interface and the manifest
are the product boundary; Query, Mutation, MCP, arbitrary URL, HTML, JavaScript,
CSS, external embeds, and model-authored factual props are all unavailable by
construction, and the whole composition is validated before anything renders.

`@openuidev/lang-core` ships an install-time telemetry `postinstall`. The
`allowBuilds` allowlist in `pnpm-workspace.yaml` blocks it, and CI additionally
sets `DO_NOT_TRACK` and `OPENUI_TELEMETRY_DISABLED`.
