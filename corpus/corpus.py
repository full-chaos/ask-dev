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
         note="carryover=chaos4632; = Q-A", expect="serve"),
    dict(id="qa-grouped-typo", text="What's are the project statuses for each team, and what are the main drivers?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="carryover=chaos4632; typo-robustness twin of qa-grouped-clean", expect="serve"),
    dict(id="qb-scoped", text="What are the statuses of the fullchaos team's projects?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="project", group_kind=None,
         note="carryover=chaos4632; = Q-B; anchor=fullchaos/team", expect="serve"),
    dict(id="q1-bar-subject-status", text="What is the status of the Dev Health Ops project?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632; = Q1", expect="serve"),
    dict(id="q2-bar-discovered-cohort", text="Which teams are struggling, and why?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="carryover=chaos4632; = Q2", expect="serve"),
    dict(id="neg-single-subject-why", text="Why is the acr project struggling?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE (group/scope signals must stay empty); D24: expect intentionally left "
              "unset -- 3/3 reps of 2026-09-12-main-b6579178 hit an unresolved 5-turn clarification loop with no "
              "served text at all; see CHAOS-5660"),
    dict(id="neg-mentions-teams-but-not-grouped", text="How many teams own the dev-health-acr repository?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="team", group_kind=None,
         note="carryover=chaos4632 NEGATIVE for group_kind; anchor=dev-health-acr/repository", expect="serve"),
    dict(id="neg-possessive-but-same-kind", text="What is the fullchaos team's status?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE for anchor (possessive-grammar trap)", expect="serve"),
    dict(id="pos-grouped-per-phrasing", text="Show me open incidents per repository.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="incident", group_kind="repository",
         note="carryover=chaos4632; CHAOS-4926 ACCEPTANCE ROW #2 / ROW-10 INCIDENT SHAPE; CHAOS-5721: rescored "
              "any_of (D27/D28/D33 servable-kind admissions overtook the scalar refuse; corpus version bump, "
              "old scoring series kept as history) -- was expect refuse basis=member_kind_unservable",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "grouped_cohort_status"}}, {"outcome": "refuse"}]}),
    dict(id="neg-explicit-comparison", text="Compare the acr project to the ask-dev project over the last 90 days.",
         family="explicit_comparison", variant="explicit_set", member_kind=None, group_kind=None,
         note="carryover=chaos4632; temporal=bounded_window; known pre-existing crash class per lane-rig-advance-13; "
              "D24: 2/3 reps of 2026-09-12-main-b6579178 served, 1/3 unserved -- not yet stable enough for a scalar serve",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "explicit_comparison"}}, {"outcome": "refuse"}]}),
    dict(id="neg-open-question", text="What should I worry about?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="carryover=chaos4632 NEGATIVE for everything; known organization_route agreement class", expect="decline"),

    # --- B. New: structural analogs of the recorded-13 frame-constructed rows (C1-C7, B5) ---
    # Real live text where the recorded-13 corpus had "QUESTION IDS ONLY -- no corpus text".
    dict(id="cv-c1-grouped-trend", text="What are the project statuses and trends for each team over the last quarter?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="analog of recorded-13 C1 (grouped team->project, assess+trend, time_series)", expect="serve"),
    dict(id="cv-c3-grouped-explain-change", text="How have each team's project statuses changed compared to last month?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="analog of recorded-13 C3 (grouped team->project, explain_change, period_comparison); CHAOS-5989: "
              "ruled SERVABLE, rescored serve -- was expect refuse", expect="serve"),
    dict(id="cv-c4-discovered-rank-both-ends", text="Rank the teams from best to worst performing, and call out both the strongest and weakest.",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="analog of recorded-13 C4 (discovered team, rank, both-ends emphasis)", expect="serve"),
    dict(id="cv-b5-org-health", text="What is the overall health of the organization?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="analog of recorded-13 B5 (organization scope, assess_state); D24: refuses stably post-CHAOS-5637 -- "
              "revisit if organization_scope member-kind widening (CHAOS-5641/D27) lands",
         expect="refuse"),
    dict(id="cv-c7-org-drivers", text="What's driving the organization's overall health right now?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="analog of recorded-13 C7's organization-scope shape (goal=explain_drivers instead of count, to avoid duplicating row 21); "
              "D24: 2/3 reps refuse cleanly, 1/3 hit an unresolved 5-turn clarification loop (CHAOS-5660 class)",
         expect={"any_of": [{"outcome": "refuse"}, {"outcome": "clarify"}]}),
    dict(id="cv-org-count-projects", text="How many projects does the organization have in total?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="project", group_kind=None,
         note="org-wide count on a SERVABLE kind (project); contrasts with basis-discovered-repo-count (unservable); "
              "D24: refused stably post-CHAOS-5637 despite this SERVABLE design note; CHAOS-5721: rescored any_of "
              "now that organization_scope member-kind widening (CHAOS-5641/D27, plus D28/D33) landed -- corpus "
              "version bump, old scoring series kept as history",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "discovered_cohort_ranking"}}, {"outcome": "refuse"}]}),

    # --- C. Unservable member-kind basis -- CHAOS-4926 class (I6-legal, cohort-wire-contract-illegal) ---
    # servableCohortKinds = {team, project} only (acr/internal/contextfabric/graphrank/cohort_kind.go:104-107).
    # Every row below is a LEGAL frame (I6 satisfied: group_kind != member_kind where applicable) whose
    # declared member_kind is outside the v1 cohort wire contract -- expect basis=member_kind_unservable.
    dict(id="basis-discovered-repo-count", text="How many repositories are there across the organization?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="repository", group_kind=None,
         note="CHAOS-4926 class, 3rd instance; analog of recorded-13 C7 (org-wide repository count); CHAOS-5721: "
              "rescored any_of (D27/D28/D33 overtook the scalar refuse; corpus version bump, old scoring series "
              "kept as history) -- was expect refuse basis=member_kind_unservable",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "discovered_cohort_ranking"}}, {"outcome": "refuse"}]}),
    dict(id="basis-grouped-pr-by-project", text="Show me open pull requests per project.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="pull_request", group_kind="project",
         note="CHAOS-4926 class; CHAOS-5721: rescored any_of (D27/D28/D33 overtook the scalar refuse; corpus "
              "version bump, old scoring series kept as history) -- was expect refuse basis=member_kind_unservable",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "grouped_cohort_status"}}, {"outcome": "refuse"}]}),
    dict(id="basis-grouped-deployment-by-team", text="Show me deployments per team.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="deployment", group_kind="team",
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-discovered-incidents", text="Which incidents need the most attention right now?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="incident", group_kind=None,
         note="CHAOS-4926 class; CHAOS-5721: rescored any_of (D27/D28/D33 overtook the scalar refuse; corpus "
              "version bump, old scoring series kept as history) -- was expect refuse basis=member_kind_unservable",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "discovered_cohort_ranking"}}, {"outcome": "refuse"}]}),
    dict(id="basis-scoped-workitems-by-project", text="What work items does the Dev Health Ops project have?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="work_item", group_kind=None,
         note="CHAOS-4926 class; anchor=Dev Health Ops/project; CHAOS-5989: ruled SERVABLE, rescored serve -- "
              "was expect refuse basis=member_kind_unservable",
         expect="serve"),
    dict(id="basis-discovered-documents", text="What documents exist in the organization?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="document", group_kind=None,
         note="CHAOS-4926 class; expect refuse basis=member_kind_unservable",
         expect="refuse"),
    dict(id="basis-grouped-metric-by-repo", text="Show me metrics per repository.",
         family="grouped_cohort_status", variant="grouped_members", member_kind="metric", group_kind="repository",
         note="CHAOS-4926 class; CHAOS-5721 rescored any_of (D27/D28/D33 overtook the scalar refuse); CHAOS-5989: "
              "ruled SERVABLE, drops any_of, rescored scalar serve -- was expect refuse basis=member_kind_unservable",
         expect="serve"),

    # --- D. Additional servable coverage -- goal/temporal breadth on servable kinds (team/project) ---
    dict(id="cv-discovered-project-behind", text="Which projects are behind schedule?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="project", group_kind=None,
         note="SERVABLE; goal=rank_or_survey", expect="serve"),
    dict(id="cv-scoped-projects-by-team-bounded", text="Which projects has the fullchaos team shipped in the last 30 days?",
         family="scoped_cohort_status", variant="children_of_scope", member_kind="project", group_kind=None,
         note="SERVABLE; anchor=fullchaos/team; temporal=bounded_window; CHAOS-5721: refuse branch dropped now "
              "that the role-aware declared-kind terminal landed (acr #544 74d8fc4c) -- the refuse branch had "
              "certified a role-blind terminal error as agree; corpus version bump, old scoring series kept as "
              "history",
         expect={"any_of": [{"outcome": "serve", "answer": {"family": "scoped_cohort_status"}}]}),
    dict(id="cv-grouped-allocate", text="How is engineering investment allocated across each team's projects?",
         family="grouped_cohort_status", variant="grouped_members", member_kind="project", group_kind="team",
         note="SERVABLE; goal=allocate_investment", expect="serve"),
    dict(id="cv-discovered-team-series", text="How has each team's health trended over the last two quarters?",
         family="discovered_cohort_ranking", variant="discovered_kind", member_kind="team", group_kind=None,
         note="SERVABLE; goal=describe_trend; temporal=time_series", expect="serve"),
    dict(id="cv-named-project-drivers", text="What's driving the ask-dev project's current status?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="SERVABLE; goal=explain_drivers", expect="serve"),
    dict(id="cv-named-project-completion", text="How much of the acr project's roadmap is complete?",
         family="subject_investigation", variant="named_subject", member_kind=None, group_kind=None,
         note="SERVABLE; obligation=completion; D24: expect intentionally left unset -- 3/3 reps of "
              "2026-09-12-main-b6579178 hit an unresolved 5-turn clarification loop with no served text at all, "
              "despite this row's own SERVABLE design note; see CHAOS-5660"),
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
         note="NEGATIVE for anchor/group emission (project analog of neg-possessive-but-same-kind)", expect="serve"),
    dict(id="neg-open-vague", text="Where should we focus next?",
         family="subject_investigation", variant="organization_scope", member_kind=None, group_kind=None,
         note="NEGATIVE for everything (analog of neg-open-question); no subject axis at all", expect="decline"),
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

# =====================================================================================
# CONVERSATIONS -- DRAFT, isolated from CORPUS. lane-corpus-conversation-draft, 2026-09-17.
#
# NOT wired into CORPUS, REQUESTED_KIND, ANCHOR_KIND, harness.py, or any existing assert.
# Nothing above this line sees this section; nothing below reads it either yet -- it is
# a schema proposal, scored/consumed only by a future harness extension (see the design
# note in .remember/lanes/lane-corpus-conversation-draft/PICKUP.md, which names ids and
# shapes only -- never this file's question text).
#
# WHY THIS EXISTS: the 36-row CORPUS above is structurally blind to conversations. Every
# multi-turn row in it is a CLARIFICATION LOOP -- the harness resends the same bare
# question with a receipt (priorKindReceipts / priorWindowReceipts / priorSubjectReceipts)
# until the subject commits on the terminal turn. No row has "turn 1 is answered, then an
# independent follow-up arrives" -- the shape a real Ask Dev conversation actually sends
# (parentResultId + subject_hints, ask-dev src/lib/conversation.ts deriveParentReference).
# Each entry below is instead an AUTHORED multi-turn conversation: every turn has its own
# text and its own `expect`, and turn N>1's parent is turn N-1's result (not a receipt).
#
# SUBJECTS: every named team subject below is SERVED by the data venue (k3s acr-trial-data
# trial-clickhouse dh_0906 carries team_repo_ownership rows only for gh:ops-team, gl:full.chaos
# and CHAOS; team authorization is ownership-derived). Teams used: team:gh:ops-team (label
# "Ops Team") and team:gl:full.chaos (label "fullchaos"); the ambiguous "fullchaos" family
# (team:CHAOS / team:FC) is not used as a named subject. Projects: project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d
# (label "Dev Health Ops"), project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244
# (label "Ask Dev"), project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72
# (label "Auth Control Plane"). Nonexistent (reused from CORPUS's own confirmed-absent
# negative control): project "Quantum Leap"; the unresolvable `acr` project token appears
# only in the one designated unanswerable row.
#
# Per turn: text (the ONLY place this text may ever appear), family/variant/member_kind/
# group_kind mirroring CORPUS's own vocabulary, requested_kind/anchor_kind ("" / None
# where no kind confirmation or no anchor is expected, matching CORPUS's own convention),
# expect in the SAME vocabulary expectations.py already scores (serve/decline/refuse/
# clarify/any_of -- CLARIFY is an existing scorer constant, not a new one), and for an
# expected serve, expected_subject={"kind":..., "canonical_id":...}; for an expected
# clarify, clarify_candidates=[{"kind":..., "canonical_id":..., "remembered": bool}, ...]
# with the remembered (pre-selected, per the CHAOS-5835 step-2 conservative contract)
# candidate FIRST. `parent` = "turn{n-1}" for every turn after the first (the harness
# extension resolves this to that turn's own result_id, never a receipt).
# =====================================================================================

CONVERSATIONS = [
    dict(
        id="conv-identical-repeat-team",
        shape="(a) identical question repeated -> same answer, same subject",
        turns=[
            dict(n=1, text="What is the Ops Team's status?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What is the Ops Team's status?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 2: byte-identical text re-asked; same subject, same answer (chris's "
                      "5-second-later example -- resolves via the turn's own text, no carry needed)"),
        ],
    ),
    dict(
        id="conv-followup-no-subject-devhealthops",
        shape="(b) follow-up naming no subject (pronoun) after a served turn -> clarify, "
              "remembered subject pre-selected first",
        turns=[
            dict(n=1, text="What is the status of the Dev Health Ops project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What's driving that?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind=None,
                 expect="clarify",
                 clarify_candidates=[
                     {"kind": "project",
                      "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d",
                      "remembered": True},
                 ],
                 note="turn 2: own text names no subject; remembered Dev Health Ops offered as "
                      "the PRE-SELECTED clarification option, never a silent serve; "
                      "refusal-with-reason for a non-clarifying caller"),
            dict(n=3, text="What's driving that?", parent="turn2",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 redeem={"kind": "project", "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d"},
                 expect="serve", expected_subject={"kind": "project", "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d"},
                 note="turn 3: REDEMPTION -- selects the offered remembered option; the engine must serve an answer with data for that subject"),
        ],
    ),
    dict(
        id="conv-followup-different-project-same-kind",
        shape="(c) follow-up naming a DIFFERENT subject of the same kind -> clarify, never a "
              "silent serve of either",
        turns=[
            dict(n=1, text="What is the status of the Dev Health Ops project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What about the Ask Dev project?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="clarify",
                 clarify_candidates=[
                     {"kind": "project",
                      "canonical_id": "project.v2:linear:6241316a-85be-42ce-b243-8e41f2b18c8d",
                      "remembered": True},
                     {"kind": "project",
                      "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244",
                      "remembered": False},
                 ],
                 note="turn 2: own text names a different same-kind subject; clarify with both "
                      "candidates, never a silent serve of the remembered OR the named one"),
            dict(n=3, text='What about the Ask Dev project?', parent="turn2",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 redeem={"kind": "project", "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 expect="serve", expected_subject={"kind": "project", "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 3: REDEMPTION -- selects the newly named option; must serve with data for that subject"),
        ],
    ),
    dict(
        id="conv-followup-different-kind-team-to-project",
        shape="(d) follow-up naming a subject of a DIFFERENT kind -> clarify",
        turns=[
            dict(n=1, text="What is the Ops Team's status?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What about the Auth Control Plane project?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="clarify",
                 clarify_candidates=[
                     {"kind": "team", "canonical_id": "team:gh:ops-team", "remembered": True},
                     {"kind": "project",
                      "canonical_id": "project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72",
                      "remembered": False},
                 ],
                 note="turn 2: own text names a subject of a different KIND (team->project); "
                      "clarify, never a silent serve of either"),
            dict(n=3, text='What about the Auth Control Plane project?', parent="turn2",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 redeem={"kind": "project", "canonical_id": "project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72"},
                 expect="serve", expected_subject={"kind": "project", "canonical_id": "project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72"},
                 note="turn 3: REDEMPTION -- selects the newly named project option; must serve with data for that subject"),
        ],
    ),
    dict(
        id="conv-followup-different-kind-project-to-team",
        shape="(d) follow-up naming a subject of a DIFFERENT kind, opposite direction "
              "(project->team) -> clarify",
        turns=[
            dict(n=1, text="What is the status of the Ask Dev project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What about the Ops Team?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="clarify",
                 clarify_candidates=[
                     {"kind": "project",
                      "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244",
                      "remembered": True},
                     {"kind": "team", "canonical_id": "team:gh:ops-team", "remembered": False},
                 ],
                 note="turn 2: own text names a subject of a different KIND (project->team); "
                      "clarify, never a silent serve of either"),
            dict(n=3, text='What about the Ops Team?', parent="turn2",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 redeem={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 3: REDEMPTION -- selects the newly named team option; must serve with data for that subject"),
        ],
    ),
    dict(
        id="conv-window-change-ops-team",
        shape="(e) same subject, changed time window -> served for the same subject with the "
              "new window (CHAOS-5895 shape: a follow-up must not veto its own range axis)",
        turns=[
            dict(n=1, text="Which projects has the Ops Team shipped in the last 30 days?",
                 family="scoped_cohort_status", variant="children_of_scope",
                 member_kind="project", group_kind=None, requested_kind="project",
                 anchor_kind="team", temporal="bounded_window_30d",
                 expect="serve",
                 expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 1: scoped cohort, bounded window, serve"),
            dict(n=2, text="What about the last 90 days?", parent="turn1",
                 family="scoped_cohort_status", variant="children_of_scope",
                 member_kind="project", group_kind=None, requested_kind="project",
                 anchor_kind=None, temporal="bounded_window_90d",
                 expect="serve",
                 expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 2: own text names no subject, only a new window; SAME subject "
                      "carries, window updates to 90d -- must not refuse/veto the range axis"),
        ],
    ),
    dict(
        id="conv-obligation-state-to-drivers-askdev",
        shape="(f) same subject, different obligation (state -> drivers) -> served for the "
              "same subject",
        turns=[
            dict(n=1, text="What is the status of the Ask Dev project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 1: state obligation, serve"),
            dict(n=2, text="What's driving the Ask Dev project's status right now?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 2: own text re-names the SAME subject explicitly, obligation "
                      "changes state->drivers; serve, same subject"),
        ],
    ),
    dict(
        id="conv-obligation-state-to-completion-authcp",
        shape="(f) same subject, different obligation (state -> completion roll-up) -> served "
              "for the same subject",
        turns=[
            dict(n=1, text="What is the status of the Auth Control Plane project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72"},
                 note="turn 1: state obligation, serve"),
            dict(n=2, text="How much of the Auth Control Plane project's roadmap is complete?",
                 parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:523e2582-b54b-4e86-8f4d-0db6e5224b72"},
                 note="turn 2: own text re-names the SAME subject explicitly, obligation "
                      "changes state->completion; serve, same subject, roll-up basis disclosed "
                      "per the Completion=roll-up ruling"),
        ],
    ),
    dict(
        id="conv-laundering-subject-change-then-repeat",
        shape="(g) four-turn chain: turn 2 changes subject (clarify), turn 3 redeems it, turn 4 "
              "repeats turn 2's own question -> turn 4 must bind to turn 2's subject, NEVER turn 1's "
              "(the wrong-subject/'laundering' shape)",
        turns=[
            dict(n=1, text="What is the Ops Team's status?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 1: named subject, serve"),
            dict(n=2, text="What is the full.chaos team's status?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="clarify",
                 clarify_candidates=[
                     {"kind": "team", "canonical_id": "team:gh:ops-team", "remembered": True},
                     {"kind": "team", "canonical_id": "team:gl:full.chaos", "remembered": False},
                 ],
                 note="turn 2: own text names a different same-kind subject with no hint; "
                      "clarify (subject-change always clarifies), never a silent serve"),
            dict(n=3, text="What is the full.chaos team's status?", parent="turn2",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 redeem={"kind": "team", "canonical_id": "team:gl:full.chaos"},
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gl:full.chaos"},
                 note="turn 3: REDEMPTION -- selects the newly named full.chaos option offered by turn 2; must serve with data for full.chaos"),
            dict(n=4, text="What is the full.chaos team's status?", parent="turn3",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gl:full.chaos"},
                 note="turn 4: byte-identical repeat of turn 2's own text; must bind to turn "
                      "2's subject (full.chaos) via its own text, and must NEVER revert to turn 1's "
                      "remembered subject (Ops Team) -- the laundering guard this shape exists to "
                      "prove"),
        ],
    ),
    dict(
        id="conv-followup-after-decline-no-memory",
        shape="(h) follow-up after a turn that was REFUSED/DECLINED -> no remembered subject "
              "exists to offer",
        turns=[
            dict(n=1, text="What is the status of the 'Quantum Leap' project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 expect="decline", nonexistent=True,
                 note="turn 1: nonexistent project (CORPUS's own confirmed-absent negative "
                      "control); decline, commits no subject"),
            dict(n=2, text="What's driving that?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind=None,
                 expect="decline",
                 note="turn 2: own text names no subject; turn 1 committed nothing, so no "
                      "remembered subject exists to pre-select -- decline (unresolvable), "
                      "NOT the clarify-with-remembered-option shape of (b)"),
        ],
    ),
    dict(
        id="conv-cohort-then-named-member",
        shape="(i) follow-up to a cohort answer, asking about one member by name -> served, "
              "bound to that member",
        turns=[
            dict(n=1, text="Which teams are struggling, and why?",
                 family="discovered_cohort_ranking", variant="discovered_kind",
                 member_kind="team", group_kind=None, requested_kind="team", anchor_kind=None,
                 expect="serve",
                 note="turn 1: discovered cohort of teams, serve; no single subject committed"),
            dict(n=2, text="What about the Ops Team specifically?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind="team",
                 expect="serve", expected_subject={"kind": "team", "canonical_id": "team:gh:ops-team"},
                 note="turn 2: own text names one real member of the prior cohort's kind by "
                      "name; serve, bound to that member"),
        ],
    ),
    dict(
        id="conv-window-change-askdev-project",
        shape="(e) same subject, changed time window -- project-kind variant of the "
              "CHAOS-5895 shape (subject kind diversity from conv-window-change-ops-team's "
              "team-kind case)",
        turns=[
            dict(n=1, text="What was the Ask Dev project's status over the last 30 days?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 temporal="bounded_window_30d",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 1: named subject, bounded window, serve"),
            dict(n=2, text="What about the last 90 days?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind=None,
                 temporal="bounded_window_90d",
                 expect="serve",
                 expected_subject={"kind": "project",
                                   "canonical_id": "project.v2:linear:13e65c04-40ec-4a95-8216-f7c2ce233244"},
                 note="turn 2: own text names no subject, only a new window; SAME subject "
                      "carries, window updates to 90d"),
        ],
    ),
    dict(
        id="conv-unanswerable-acr-token",
        shape="(j) designated unanswerable case: the unresolvable 'acr' project acronym "
              "token, and a follow-up compounding it",
        turns=[
            dict(n=1, text="What is the status of the acr project?",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="project", anchor_kind="project",
                 # no `expect` key: intentionally UNSET, mirroring CORPUS's own
                 # cv-named-project-completion / neg-single-subject-why rows (D24/1952:
                 # the bare acronym does not resolve to a real project token; unanswerable
                 # without offering real project options, per the CHAOS-5660 backlog note)
                 note="turn 1: unresolvable acronym token; UNSET (unanswerable-without-"
                      "options), per ruling 1952 -- the one designated case using this token"),
            dict(n=2, text="What about now?", parent="turn1",
                 family="subject_investigation", variant="named_subject",
                 member_kind=None, group_kind=None, requested_kind="", anchor_kind=None,
                 note="turn 2: own text names no subject; turn 1 never committed one, so "
                      "nothing is remembered -- UNSET for the same reason as turn 1, not the "
                      "clarify-with-remembered-option shape of (b)"),
        ],
    ),
]

# Every clarify turn is followed by a redemption turn (a clarification counts only when the next
# turn selects the offered option and the engine serves with data for that subject).
for _c in CONVERSATIONS:
    for _i, _t in enumerate(_c["turns"]):
        if _t.get("expect") == "clarify":
            assert _i + 1 < len(_c["turns"]) and _c["turns"][_i + 1].get("redeem"), (
                f"{_c['id']} turn{_i + 1}: clarify turn needs a redemption turn after it")
        if _t.get("redeem"):
            assert _c["turns"][_i - 1].get("expect") == "clarify" and _t.get("expect") == "serve"

assert 10 <= len(CONVERSATIONS) <= 14, f"expected 10-14 conversations, got {len(CONVERSATIONS)}"
assert len({c["id"] for c in CONVERSATIONS}) == len(CONVERSATIONS), "duplicate conversation id"
for _conv in CONVERSATIONS:
    assert len(_conv["turns"]) >= 2, f"{_conv['id']}: every conversation needs >=2 turns"
    assert _conv["turns"][0].get("parent") is None, f"{_conv['id']}: turn 1 must have no parent"
    for _i, _t in enumerate(_conv["turns"][1:], start=2):
        assert _t.get("parent") == f"turn{_i - 1}", (
            f"{_conv['id']} turn{_i}: parent must be the immediately preceding turn's result "
            "(never a receipt)")
