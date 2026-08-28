# AGENTS.md — ask-dev

Context Fabric Workbench (CHAOS-3738). See [`README.md`](README.md) for what this repo is and is not.

## North Star (read before changing Ask Dev / Context Fabric behavior)

Canonical intent documents (Linear, Dev Health Ops project):

- **Ask Dev / Dev Health Ops North Star Summary**: https://linear.app/fullchaos/document/ask-dev-dev-health-ops-north-star-summary-eb80e9e132a4 — the standard future implementation decisions are measured against.
- **Dev Health Ops Purpose and Contract**: https://linear.app/fullchaos/document/dev-health-ops-purpose-and-contract-2026-08-28-112058-pdt-d6e5c6c391b9 — question contracts, answer schema, boundaries.
- **Review of North Star Summary**: https://linear.app/fullchaos/document/review-of-north-star-summary-2026-08-28-97180bc4b921

One-line definition: _Ask Dev turns a natural engineering question into a bounded investigation across canonical facts, organizational context, graph evidence, and derived findings, then returns the strongest defensible explanation, evidence, uncertainty, and next action in the form best suited to the user's intent._

Design checks every Ask Dev / acr / ops-metrics change must pass — checks 1–15 are North Star §22 principles; checks 16–18 are repository operating rules from the review doc above:

1. Intent determines evidence — never answer the nearest measurable question.
2. Retrieval is part of reasoning — correct intent with failed retrieval is a failed answer.
3. Preserve semantic distinctions — status ≠ completion ≠ readiness ≠ health ≠ pressure ≠ investment ≠ burden ≠ productivity.
4. Evidence rules constrain claims; they do not refuse the conversation.
5. Make partial truth useful.
6. Memory carries investigation context (subject, cohort, scope, window, comparison basis persist across turns).
7. Graph edges establish relevance, not cause.
8. Scores help prioritize; drivers explain — never a bare score.
9. Investment explains tradeoffs.
10. Rich views (tables, landscapes, treemap/sunburst/sankey, burndown, Monte Carlo) are conditional on intent, never default.
11. The answer contract is richer than the prose (completeness/terminal state/coverage are public contract fields).
12. Missing is not healthy — unknown/stale/sparse/not-applicable/zero are distinct.
13. Small-org reality (3–8 teams, thin history) must work.
14. Prefer investigation over diagnosis-by-metric.
15. Ask Dev is the product surface over Context Fabric; metrics/graph/landscape/investment views are supporting surfaces.
16. Diagnoses need an executed repro; label code-argued findings as such.
17. Append-only daily tables + argMax readers; never zero-fill missing days.
18. Authorization is re-checked live every turn — never carried as conversation memory.

Contract rule: any acr contract widening ⇒ ask-dev pin bump before any live proof. Team authorization is ownership-derived (`team_repo_ownership` rows), so team answers are impossible until ownership is synced.

Data vocabulary: "local" = the admin@test.com org (`70d529e0`, REAL synced data on the compose stack); `dev-hops fixtures generate` = contrived CI data; "prod" = read-only post-deploy readback. Team = project/repo OWNERSHIP only (never person→membership→team); ownership is sync-derived, provider-agnostic; no manual TEAM mappings.

Checks that bite hardest here: 6, 10, 11, 15, 18 — plus: never render a bare `Score` without its `Drivers`; this is the deterministic view that must fail closed rather than mask an answer-quality failure.
