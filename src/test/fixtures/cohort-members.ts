import type { InvestigationResult } from "@/lib/contracts";

import openCohortFamily from "./cohort-members/open-cohort-family.json";
import pullRequests from "./cohort-members/pull-requests.json";
import subjectWithCohort from "./cohort-members/subject-with-cohort.json";
import unrankedRepositories from "./cohort-members/unranked-repositories.json";
import workItems from "./cohort-members/work-items.json";
import zeroMatch from "./cohort-members/zero-match.json";

/**
 * Cohorts with nothing ranked, as ACR serves them with the labels flag on (render audit gap 1).
 *
 * Built by the real encoder at acr `d617cbd2`, never by hand: see `cohort-members/generate.go.txt`.
 * `pull-requests` is a real kiac capture (web `kiac_repo_merged_prs_degraded.event.json`) sent
 * through `ServeVocabularyLabels`. It shows what a real list cohort carries: ACR's ranking pass
 * sets `ranking_computed` on every member, so "no score and no driver on any member" is what
 * means that nothing was ranked. `work-items` is acr's own test data. `open-cohort-family` and
 * `subject-with-cohort` are the two sides of the family gate, each with a real captured answer plan.
 */
export const cohortMemberScenarios = {
    "open-cohort-family": openCohortFamily as unknown as InvestigationResult,
    "pull-requests": pullRequests as unknown as InvestigationResult,
    "subject-with-cohort": subjectWithCohort as unknown as InvestigationResult,
    "unranked-repositories": unrankedRepositories as unknown as InvestigationResult,
    "work-items": workItems as unknown as InvestigationResult,
    "zero-match": zeroMatch as unknown as InvestigationResult,
} as const;
