import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeterministicAnswerView } from "@/components/DeterministicAnswerView";
import { InspectorRail } from "@/components/chat/InspectorRail";
import type { InvestigationResult } from "@/lib/contracts";
import { withholdUnrankableRankings } from "@/lib/ranking-withheld";
import { servedWordScenarios as served } from "@/test/fixtures/served-words";

afterEach(cleanup);

/** CHAOS-12245: the raw words of `status` and `completeness.state`, as the wire spells them. */
const RAW_WORD =
    /\b(?:complete|partial|degraded|not[ _]derived|no[ _]match|clarification[ _]required)\b/u;

function draw(result: InvestigationResult) {
    return render(<DeterministicAnswerView result={result} />).container;
}

/** What a reader sees with every fold closed. */
function outsideFolds(root: Element): string {
    const copy = root.cloneNode(true) as Element;
    for (const fold of copy.querySelectorAll("details")) fold.remove();
    return copy.textContent ?? "";
}

function withoutMap(result: InvestigationResult): InvestigationResult {
    const { vocabulary_labels: _dropped, ...rest } = result;
    return rest;
}

function withoutStatusKeys(result: InvestigationResult): InvestigationResult {
    const entries = Object.entries(result.vocabulary_labels ?? {}).filter(
        ([key]) => !key.startsWith("answer_status:"),
    );
    return { ...result, vocabulary_labels: Object.fromEntries(entries) };
}

/** Each served word replaced by a word no generic path can write, so a test sees the lookup. */
function withMarkedWords(result: InvestigationResult): InvestigationResult {
    const marked: Record<string, string> = {};
    for (const key of Object.keys(result.vocabulary_labels ?? {})) marked[key] = `«${key}»`;
    return { ...result, vocabulary_labels: marked };
}

const pill = () => screen.getByTestId("ask-dev-answer-status");
const notePresent = () => screen.queryByTestId("answer-status-correction") !== null;

describe("the status pill reads the served word (CHAOS-12417)", () => {
    it.each([
        ["full-answer", "Full answer"],
        ["plain-answer", "Answer"],
        ["not-fully-covered", "Answer, not fully covered"],
        ["corrected", "Partial answer"],
        ["degraded", "Degraded answer"],
        ["no-match", "No answer"],
        ["clarification", "Answer needs your confirmation"],
    ] as const)("%s", (name, word) => {
        draw(served[name]);
        expect(pill()).toHaveTextContent(new RegExp(`^${word}$`, "u"));
    });

    it("draws one pill for one answer", () => {
        draw(served.corrected);
        expect(screen.getAllByTestId("ask-dev-answer-status")).toHaveLength(1);
    });
});

describe("with no served word (lead's ruling on CHAOS-12417)", () => {
    for (const [form, without] of [
        ["no map at all", withoutMap],
        ["a map with no status key", withoutStatusKeys],
    ] as const) {
        it.each(["full-answer", "corrected", "degraded", "not-fully-covered"] as const)(
            `${form}: %s reads the neutral "Answer", never "Full answer" or a raw word`,
            (name) => {
                draw(without(served[name]));
                expect(pill()).toHaveTextContent(/^Answer$/u);
            },
        );

        it.each(["no-match", "clarification"] as const)(
            `${form}: %s is not an answered status, so it has no pill`,
            (name) => {
                draw(without(served[name]));
                expect(screen.queryByTestId("ask-dev-answer-status")).toBeNull();
            },
        );
    }

    it("leaves the correction note out, and the coverage block still stands", () => {
        const root = draw(withoutMap(served.corrected));
        expect(notePresent()).toBe(false);
        expect(root.textContent).not.toMatch(/lowered this answer/u);
        expect(screen.getByRole("group", { name: "Coverage" })).toBeVisible();
    });

    it("a withheld ranking arrives with no map: neutral pill, no note, no raw word", () => {
        const person = {
            ...served.corrected,
            cohort: { ...served.corrected.cohort!, kind: "person" },
        } as InvestigationResult;
        const { result, rankingWithheld } = withholdUnrankableRankings(person);
        expect(result.vocabulary_labels).toBeUndefined();
        render(<DeterministicAnswerView rankingWithheld={rankingWithheld} result={result} />);
        expect(pill()).toHaveTextContent(/^Answer$/u);
        expect(notePresent()).toBe(false);
        expect(outsideFolds(screen.getByTestId("completeness-panel"))).not.toMatch(RAW_WORD);
    });
});

describe("the correction note", () => {
    it("is the service's own sentence, and says no raw status word", () => {
        draw(served.corrected);
        const note = screen.getByTestId("answer-status-correction");
        expect(note).toHaveTextContent(
            served.corrected.vocabulary_labels!["status_correction:note"]!,
        );
        expect(note.textContent).not.toMatch(RAW_WORD);
    });

    it.each(["full-answer", "plain-answer", "degraded", "no-match", "clarification"] as const)(
        "%s carries no correction, so it has no note",
        (name) => {
            draw(served[name]);
            expect(notePresent()).toBe(false);
        },
    );
});

describe("completeness never shows (CHAOS-12245)", () => {
    it.each(Object.keys(served) as (keyof typeof served)[])("%s", (name) => {
        draw(served[name]);
        expect(outsideFolds(screen.getByTestId("completeness-panel"))).not.toMatch(RAW_WORD);
        expect(outsideFolds(screen.getByTestId("completeness-panel"))).not.toMatch(
            /Partial|Degraded/u,
        );
    });

    it("a cohort member shows its driver rows, never its data_completeness", () => {
        draw(served["every-vocabulary"]);
        const ranking = screen.getByTestId("cohort-ranking-panel");
        expect(within(ranking).getByTestId("ranking-drivers-count")).toHaveTextContent(
            /drivers?$/u,
        );
        expect(outsideFolds(ranking)).not.toMatch(RAW_WORD);
    });
});

describe("the fold (CHAOS-12417)", () => {
    it("holds the requirement outcomes table, whole and closed", () => {
        draw(served.corrected);
        const table = screen.getByTestId("completeness-outcomes-table");
        const fold = table.closest("details");
        expect(fold).not.toBeNull();
        expect(fold).not.toHaveAttribute("open");
        expect(fold!.querySelector("summary")).toHaveTextContent(/^Requirement outcomes$/u);
    });

    it("reads each outcome's served word inside the fold", () => {
        draw(withMarkedWords(served.corrected));
        expect(screen.getByTestId("completeness-outcomes-table")).toHaveTextContent(
            "«requirement_outcome:narrowed»",
        );
    });

    it("says nothing when no outcome was derived: that sentence only restates the state", () => {
        const root = draw(served["plain-answer"]);
        expect(screen.queryByTestId("completeness-outcomes-table")).toBeNull();
        expect(screen.queryByTestId("completeness-outcomes-empty")).toBeNull();
        expect(root.textContent).not.toMatch(/Requirement outcomes/u);
    });

    it("holds the stop reason", () => {
        draw(served.corrected);
        const fold = screen.getByTestId("completeness-terminal-reason").closest("details");
        expect(fold).not.toBeNull();
        expect(fold).not.toHaveAttribute("open");
    });
});

describe("the missing data sentence", () => {
    it("reads the outcome's served word", () => {
        draw(withMarkedWords(served.corrected));
        expect(screen.getByTestId("completeness-missing-data")).toHaveTextContent(
            "Missing data: health «requirement_outcome:narrowed» (1 of 2).",
        );
    });

    it("takes the generic path for an outcome with no word", () => {
        draw(withoutMap(served.corrected));
        expect(screen.getByTestId("completeness-missing-data")).toHaveTextContent(
            "Missing data: health narrowed (1 of 2).",
        );
    });
});

describe("the ranking heading (no pluralizer)", () => {
    it("reads the served plural", () => {
        draw(served["every-vocabulary"]);
        expect(screen.getByRole("heading", { name: "Ranked repositories" })).toBeVisible();
    });

    it("never writes a plural of its own", () => {
        const root = draw(withoutMap(served["every-vocabulary"]));
        expect(screen.getByRole("heading", { name: "Ranked members" })).toBeVisible();
        expect(root.textContent).not.toMatch(/repositorys/u);
    });

    it("the cut cohort's notice reads the same words", () => {
        const result = served["every-vocabulary"];
        draw({ ...result, cohort: { ...result.cohort!, complete: false, truncated: true } });
        expect(screen.getByTestId("cohort-incomplete-notice")).toHaveTextContent(
            /only the repositories the service returned.*not every repository/u,
        );
    });
});

describe("each vocabulary reads its served word, outside the fold", () => {
    const keys = [
        "subject_kind:repository",
        "subject_kind_plural:repository",
        "member_outcome:provisional",
        "driver_window:current_vs_prior",
        "ranking_signal:health.compounding_risk",
        "ranking_signal:workload.forecast_pressure",
        "driver_standing:principal",
        "candidate_state:committed",
        "prior_receipt_disposition:skipped_stale_graph_epoch",
        "structure_disposition:applied",
        "window_relative_id:trailing_30d",
        "window_provenance:question_stated",
    ];

    it.each(keys)("%s", (key) => {
        const root = draw(withMarkedWords(served["every-vocabulary"]));
        expect(root.textContent).toContain(`«${key}»`);
    });

    it("threshold_label, on the member's top driver", () => {
        const result = withMarkedWords(served["every-vocabulary"]);
        const [first, ...others] = result.cohort!.members;
        const drivers = first!.drivers!.filter((driver) => driver.signal === "investment_mix");
        const members = [{ ...first!, drivers }, ...others];
        const cohort = { ...result.cohort!, members };
        const root = draw({ ...result, cohort } as unknown as InvestigationResult);
        expect(root.textContent).toContain("«threshold_label:investment_mix.reactive_share_high»");
        expect(root.textContent).toContain("«ranking_signal:investment_mix»");
    });

    it("a new value needs no change here: the lookup is not a table", () => {
        const result = served["every-vocabulary"];
        const drivers = [
            { ...result.drivers[0]!, standing: "brand_new" },
            ...result.drivers.slice(1),
        ];
        draw({
            ...result,
            drivers,
            vocabulary_labels: {
                ...result.vocabulary_labels,
                "driver_standing:brand_new": "a new word",
            },
        });
        expect(screen.getAllByText("a new word").length).toBeGreaterThan(0);
    });

    it("a value with no entry takes the generic path", () => {
        const result = served["every-vocabulary"];
        const drivers = [
            { ...result.drivers[0]!, standing: "brand_new" },
            ...result.drivers.slice(1),
        ];
        const root = draw({ ...result, drivers });
        expect(root.textContent).toContain("brand new");
    });

    it("candidate_state, on a clarification's own candidate list", () => {
        const every = withMarkedWords(served["every-vocabulary"]);
        const [candidate] = every.subject_resolution.candidates;
        const result = {
            ...every,
            status: "clarification_required",
            subject_resolution: { ...every.subject_resolution, candidates: [candidate!] },
        } as InvestigationResult;
        const root = draw(result);
        expect(root.textContent).toContain("«candidate_state:committed»");
    });

    it("subject_kind, on a group's heading and on a counted kind", () => {
        const every = withMarkedWords(served["every-vocabulary"]);
        const group = {
            subject: { kind: "team", canonical_id: "team:beta", label: "Team Beta" },
            member_canonical_ids: [],
            complete: true,
            truncated: false,
            total: 1,
        };
        const detail = {
            ...every.coverage.details?.[0],
            detail_id: "detail_kind_census",
            code: "kind_census_truncated",
            kind: "repository",
            declared: 3,
            served: 1,
        };
        const root = draw({
            ...every,
            cohort: { ...every.cohort!, groups: [group] },
            coverage: { ...every.coverage, details: [detail] },
        } as unknown as InvestigationResult);
        const groups = root.querySelector('[data-testid="cohort-groups-panel"]');
        expect(groups?.textContent).toContain("«subject_kind:repository»");
        expect(screen.getByRole("group", { name: "Coverage" })).toHaveTextContent(
            "«subject_kind:repository»:",
        );
    });

    it("fact_kind, on a finding and on a table of rows", () => {
        const every = withMarkedWords(served["every-vocabulary"]);
        const root = draw(every);
        expect(outsideFolds(root)).toContain("«fact_kind:narrative»");
        expect(outsideFolds(root)).toContain("«fact_kind:readiness» ·");
    });

    it("the rail reads the served window words", () => {
        render(<InspectorRail result={withMarkedWords(served["every-vocabulary"])} />);
        const rail = screen.getByRole("complementary", { name: "Latest answer sources" });
        expect(rail).toHaveTextContent("«window_relative_id:trailing_30d»");
        expect(rail).toHaveTextContent("«window_provenance:question_stated»");
    });
});

describe("unknown, stale, no data, not applicable and zero stay distinct", () => {
    it("each source state keeps its own served word, and zero stays a count", () => {
        const result = served["every-vocabulary"];
        draw({
            ...result,
            completeness: { ...result.completeness, claimed_facts_count: 0, rows_count: 0 },
        });
        const coverage = screen.getByRole("group", { name: "Coverage" });
        for (const word of ["may be out of date", "unavailable", "no data", "not applicable"]) {
            expect(within(coverage).getAllByText(word).length).toBeGreaterThan(0);
        }
        expect(screen.getByText("No facts stand behind this answer.")).toBeVisible();
    });
});
