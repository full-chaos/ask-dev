import { describe, expect, it } from "vitest";

import { literalKindNounsInQuestion } from "@/lib/kind-nouns";

describe("literalKindNounsInQuestion (CHAOS-4343 item 3)", () => {
    it("returns nothing for a question with no literal kind noun", () => {
        expect(literalKindNounsInQuestion("Is Atlas on track?")).toEqual([]);
    });

    it("matches the ticket's own example: 'project' binds to expected_kind project", () => {
        expect(
            literalKindNounsInQuestion("What is the status of the dev-health-ops project?"),
        ).toEqual(["project"]);
    });

    it("matches 'repository' and 'team' too", () => {
        expect(literalKindNounsInQuestion("Which repository does that team own?")).toEqual([
            "repository",
            "team",
        ]);
    });

    it("matches plural forms", () => {
        expect(literalKindNounsInQuestion("How many projects does this team have?")).toEqual([
            "project",
            "team",
        ]);
        expect(literalKindNounsInQuestion("List the repositories.")).toEqual(["repository"]);
    });

    it("is case-insensitive", () => {
        expect(literalKindNounsInQuestion("PROJECT status?")).toEqual(["project"]);
    });

    it("never matches a substring of a longer word", () => {
        // "reprojection" contains "project" as a substring but is not the
        // word "project" — a naive non-word-boundary match would wrongly
        // fire here.
        expect(literalKindNounsInQuestion("Explain the reprojection step.")).toEqual([]);
        expect(literalKindNounsInQuestion("teamwork matters here.")).toEqual([]);
    });

    it("deduplicates a repeated noun and returns it once", () => {
        expect(literalKindNounsInQuestion("Is this project the same project as before?")).toEqual([
            "project",
        ]);
    });

    it("returns matches in the fixed vocabulary order, not the order the words appear", () => {
        // "team" appears before "project" in the text, but the fixed order
        // (project, repository, team) must still win.
        expect(literalKindNounsInQuestion("Which team owns this project?")).toEqual([
            "project",
            "team",
        ]);
    });
});
