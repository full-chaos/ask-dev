"""lane-corpus-v2 labelled corpus — 36 questions, real org 70d529e0 entities only.

Real entities confirmed by prior live rig runs (never invented):
  teams:        fullchaos
  # platform removed 2026-09-05: not a team in org 70d529e0 (ClickHouse census 17 teams, none platform)
  projects:     Dev Health Ops, acr, ask-dev
  repository:   dev-health-acr
  org:          70d529e0 itself
Nonexistent (deliberate negative controls, confirmed absent by prior lane runs):
  team "Nebula Strike Force", project "Quantum Leap", repository "phantom-service"

Columns per row (id, text, intended_family, intended_variant, intended_member_kind,
intended_group_kind, note). intended_* is this lane's DESIGN hypothesis; the
deliverable table joins OBSERVED values from telemetry per request_id.
"""

CORPUS = [
    # --- A. Carryover: CHAOS-4632 labelled corpus (12), reposed for a fresh baseline ---
    # CHAOS-5597: this comment previously said "fresh 3-rep baseline" -- the actual sweep
    # (corpus/baseline-20260905-sweep1.json, provenance.reps) recorded reps=1. Corrected to
    # match the artefact of record rather than assert a rep count nothing measured.
    # Source: acr/internal/contextfabric/testdata/chaos4632_labelled_questions.json
    dict(id="qa-grouped-clean", text="What are the project statuses for each team, and what are the main drivers?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="carryover=chaos4632; = Q-A"),
    dict(id="qa-grouped-typo", text="What's are the project statuses for each team, and what are the main drivers?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="carryover=chaos4632; typo-robustness twin of qa-grouped-clean"),
    dict(id="qb-scoped", text="What are the statuses of the fullchaos team's projects?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="project", group_kind=None,
         note="carryover=chaos4632; = Q-B; anchor=fullchaos/team", expect="serve"),
    dict(id="q1-bar-subject-status", text="What is the status of the Dev Health Ops project?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632; = Q1"),
    dict(id="q2-bar-discovered-cohort", text="Which teams are struggling, and why?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="carryover=chaos4632; = Q2"),
    dict(id="neg-single-subject-why", text="Why is the acr project struggling?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE (group/scope signals must stay empty)"),
    dict(id="neg-mentions-teams-but-not-grouped", text="How many teams own the dev-health-acr repository?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="team", group_kind=None,
         note="carryover=chaos4632 NEGATIVE for group_kind; anchor=dev-health-acr/repository"),
    dict(id="neg-possessive-but-same-kind", text="What is the fullchaos team's status?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE for anchor (possessive-grammar trap)"),
    dict(id="pos-grouped-per-phrasing", text="Show me open incidents per repository.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="incident", group_kind="repository",
         note="carryover=chaos4632; CHAOS-4926 ACCEPTANCE ROW #2 / ROW-10 INCIDENT SHAPE (expect refuse basis=member_kind_unservable)",
         expect="refuse"),
    dict(id="neg-explicit-comparison", text="Compare the acr project to the ask-dev project over the last 90 days.",
         family="explicit_comparison", variant="explicit_set", member_kind=None, group_kind=None,
         note="carryover=chaos4632; temporal=bounded_window; known pre-existing crash class per lane-rig-advance-13"),
    dict(id="neg-open-question", text="What should I worry about?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE for everything; known organization_route agreement class"),

    # --- B. New: structural analogs of the recorded-13 frame-constructed rows (C1-C7, B5) ---
    # Real live text where the recorded-13 corpus had "QUESTION IDS ONLY -- no corpus text".
    dict(id="cv-c1-grouped-trend", text="What are the project statuses and trends for each team over the last quarter?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="analog of recorded-13 C1 (grouped team->project, assess+trend, time_series)"),
    dict(id="cv-c3-grouped-explain-change", text="How have each team's project statuses changed compared to last month?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="analog of recorded-13 C3 (grouped team->project, explain_change, period_comparison)"),
    dict(id="cv-c4-discovered-rank-both-ends", text="Rank the teams from best to worst performing, and call out both the strongest and weakest.",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="analog of recorded-13 C4 (discovered team, rank, both-ends emphasis)"),
    dict(id="cv-b5-org-health", text="What is the overall health of the organization?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="analog of recorded-13 B5 (organization scope, assess_state)"),
    dict(id="cv-c7-org-drivers", text="What's driving the organization's overall health right now?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="analog of recorded-13 C7's organization-scope shape (goal=explain_drivers instead of count, to avoid duplicating row 21)"),
    dict(id="cv-org-count-projects", text="How many projects does the organization have in total?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="project", group_kind=None,
         note="org-wide count on a SERVABLE kind (project); contrasts with basis-discovered-repo-count (unservable)"),

    # --- C. Unservable member-kind basis -- CHAOS-4926 class (I6-legal, cohort-wire-contract-illegal) ---
    # servableCohortKinds = {team, project} only (acr/internal/contextfabric/graphrank/cohort_kind.go:104-107).
    # Every row below is a LEGAL frame (I6 satisfied: group_kind != member_kind where applicable) whose
    # declared member_kind is outside the v1 cohort wire contract -- expect basis=member_kind_unservable.
    dict(id="basis-discovered-repo-count", text="How many repositories are there across the organization?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="repository", group_kind=None,
         note="CHAOS-4926 class, 3rd instance; analog of recorded-13 C7 (org-wide repository count); expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-grouped-pr-by-project", text="Show me open pull requests per project.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="pull_request", group_kind="project",
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-grouped-deployment-by-team", text="Show me deployments per team.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="deployment", group_kind="team",
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-discovered-incidents", text="Which incidents need the most attention right now?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="incident", group_kind=None,
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-scoped-workitems-by-project", text="What work items does the Dev Health Ops project have?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="work_item", group_kind=None,
         note="CHAOS-4926 class; anchor=Dev Health Ops/project; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-discovered-documents", text="What documents exist in the organization?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="document", group_kind=None,
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-grouped-metric-by-repo", text="Show me metrics per repository.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="metric", group_kind="repository",
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),

    # --- D. Additional servable coverage -- goal/temporal breadth on servable kinds (team/project) ---
    dict(id="cv-discovered-project-behind", text="Which projects are behind schedule?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="project", group_kind=None,
         note="SERVABLE; goal=rank_or_survey"),
    dict(id="cv-scoped-projects-by-team-bounded", text="Which projects has the fullchaos team shipped in the last 30 days?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="project", group_kind=None,
         note="SERVABLE; anchor=fullchaos/team; temporal=bounded_window"),
    dict(id="cv-grouped-allocate", text="How is engineering investment allocated across each team's projects?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="SERVABLE; goal=allocate_investment"),
    dict(id="cv-discovered-team-series", text="How has each team's health trended over the last two quarters?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="SERVABLE; goal=describe_trend; temporal=time_series"),
    dict(id="cv-named-project-drivers", text="What's driving the ask-dev project's current status?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="SERVABLE; goal=explain_drivers"),
    dict(id="cv-named-project-completion", text="How much of the acr project's roadmap is complete?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="SERVABLE; obligation=completion"),
    # --- E. Negative controls: nonexistent entity, false-emission trap, illegal-I6 probe, open/vague ---
    dict(id="neg-nonexistent-team", text="What is the status of the 'Nebula Strike Force' team?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="NEGATIVE: nonexistent team name (reused from lane-s7b-i p-neg1); expect decline with a named basis, never a fabricated answer",
         expect="decline"),
    dict(id="neg-nonexistent-project", text="What is the status of the 'Quantum Leap' project?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="NEGATIVE: nonexistent project name; expect decline with a named basis",
         expect="decline"),
    dict(id="neg-nonexistent-repo-scope", text="Which team owns the 'phantom-service' repository?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="team", group_kind=None,
         note="NEGATIVE: nonexistent scope anchor; expect decline with a named basis (unresolved anchor)",
         expect="decline"),
    dict(id="neg-illegal-i6-self-group", text="Group the teams by team.",
         family=None, variant="grouped_members", member_kind="team", group_kind="team",
         note="DELIBERATE I6-ILLEGAL PROBE (group_kind==member_kind) -- expect decline at frame validation (I6) IF the model even emits this shape; a refusal upstream of frame validation is also a valid, informative outcome. NOT a design mistake: intentionally illegal, unlike every other row in this corpus.",
         expect="decline"),
    dict(id="neg-possessive-but-same-kind-project", text="What is the ask-dev project's status?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="NEGATIVE for anchor/group emission (project analog of neg-possessive-but-same-kind)"),
    dict(id="neg-open-vague", text="Where should we focus next?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="NEGATIVE for everything (analog of neg-open-question); no subject axis at all"),
]

assert len(CORPUS) == 36, f"expected 36 rows, got {len(CORPUS)}"
assert len({row['id'] for row in CORPUS}) == 36, "duplicate id"

# requested_kind: the kind THIS question is actually about, stated explicitly
# per lane-4926-pr-b's fix (WANT_KIND table, run_rig.py:52-61) -- inferring a
# kind from question text is the exact mistake CHAOS-4926 exists to eliminate,
# and a driver that answers an `expected_kind` clarification by index (rather
# than by matching this declared kind) manufactures a wrong-kind answer.
# "" means no kind confirmation is expected (organization-as-subject / fully
# open questions). For the 12 carryover rows this is chaos4632's own
# expect_requested_kind field, quoted verbatim.
REQUESTED_KIND = {
    "qa-grouped-clean": "project", "qa-grouped-typo": "project", "qb-scoped": "project",
    "q1-bar-subject-status": "project", "q2-bar-discovered-cohort": "team",
    "neg-single-subject-why": "project", "neg-mentions-teams-but-not-grouped": "team",
    "neg-possessive-but-same-kind": "team",
    "pos-grouped-per-phrasing": "incident", "neg-explicit-comparison": "project",
    "neg-open-question": "",
    "cv-c1-grouped-trend": "project",
    "cv-c3-grouped-explain-change": "project", "cv-c4-discovered-rank-both-ends": "team",
    "cv-b5-org-health": "", "cv-c7-org-drivers": "",
    "cv-org-count-projects": "project",
    "basis-discovered-repo-count": "repository", "basis-grouped-pr-by-project": "pull_request",
    "basis-grouped-deployment-by-team": "deployment", "basis-discovered-incidents": "incident",
    "basis-scoped-workitems-by-project": "work_item", "basis-discovered-documents": "document",
    "basis-grouped-metric-by-repo": "metric",
    "cv-discovered-project-behind": "project", "cv-scoped-projects-by-team-bounded": "project",
    "cv-grouped-allocate": "project", "cv-discovered-team-series": "team",
    "cv-named-project-drivers": "project", "cv-named-project-completion": "project",
    "neg-nonexistent-team": "team", "neg-nonexistent-project": "project",
    "neg-nonexistent-repo-scope": "team", "neg-illegal-i6-self-group": "team",
    "neg-possessive-but-same-kind-project": "project", "neg-open-vague": "",
}
assert set(REQUESTED_KIND) == {row["id"] for row in CORPUS}, "REQUESTED_KIND must cover every row"
for _row in CORPUS:
    _row["requested_kind"] = REQUESTED_KIND[_row["id"]]

# anchor_kind: the kind of the NAMED entity subject_resolution is expected to
# resolve for this question -- DISTINCT from requested_kind (the kind of the
# cohort/answer subject). For children_of_scope rows the anchor is the SCOPE
# ("the platform team" -> team) while requested_kind is the MEMBER kind being
# counted/discovered ("...own?" -> repository) -- confounding the two is
# exactly team-lead's binding correction (candidates[0] committed a
# ci_pipeline_run for "the platform team" because nothing checked the
# candidate's kind against the ANCHOR's declared kind, team). None means no
# named anchor is expected at all (discovered_kind / grouped_members with no
# scope / organization_scope) -- a subject_resolution offer there has no
# criterion to match and is left uncommitted with a loud warning, same
# fail-closed discipline as REQUESTED_KIND.
ANCHOR_KIND = {
    "qa-grouped-clean": None, "qa-grouped-typo": None, "qb-scoped": "team",
    "q1-bar-subject-status": "project", "q2-bar-discovered-cohort": None,
    "neg-single-subject-why": "project", "neg-mentions-teams-but-not-grouped": "repository",
    "neg-possessive-but-same-kind": "team",
    "pos-grouped-per-phrasing": None, "neg-explicit-comparison": "project", "neg-open-question": None,
    "cv-c1-grouped-trend": None,
    "cv-c3-grouped-explain-change": None, "cv-c4-discovered-rank-both-ends": None,
    "cv-b5-org-health": None, "cv-c7-org-drivers": None,
    "cv-org-count-projects": None,
    "basis-discovered-repo-count": None, "basis-grouped-pr-by-project": None,
    "basis-grouped-deployment-by-team": None, "basis-discovered-incidents": None,
    "basis-scoped-workitems-by-project": "project", "basis-discovered-documents": None,
    "basis-grouped-metric-by-repo": None,
    "cv-discovered-project-behind": None, "cv-scoped-projects-by-team-bounded": "team",
    "cv-grouped-allocate": None, "cv-discovered-team-series": None,
    "cv-named-project-drivers": "project", "cv-named-project-completion": "project",
    "neg-nonexistent-team": "team", "neg-nonexistent-project": "project",
    "neg-nonexistent-repo-scope": "repository", "neg-illegal-i6-self-group": None,
    "neg-possessive-but-same-kind-project": "project", "neg-open-vague": None,
}
assert set(ANCHOR_KIND) == {row["id"] for row in CORPUS}, "ANCHOR_KIND must cover every row"
for _row in CORPUS:
    _row["anchor_kind"] = ANCHOR_KIND[_row["id"]]
