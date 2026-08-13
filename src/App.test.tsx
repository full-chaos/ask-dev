import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "@/App";

describe("Ask Dev Workbench shell", () => {
    it("renders the canonical result on first paint", () => {
        render(<App />);

        const result = screen.getByRole("article", { name: "Investigation result" });
        expect(
            within(result).getByText(
                /Ask Dev is not release-ready\. The principal current driver is incomplete release acceptance/,
            ),
        ).toBeInTheDocument();
        expect(within(result).getByTitle("complete")).toBeInTheDocument();
    });

    it("always shows coverage, limitations, and evidence sections", () => {
        render(<App />);

        expect(screen.getByRole("region", { name: "Coverage" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Limitations" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Evidence references" })).toBeInTheDocument();
    });

    it("shows the pruned coverage state with its contract reason", () => {
        render(<App />);

        const coverage = screen.getByRole("region", { name: "Coverage" });
        expect(within(coverage).getByTitle("pruned")).toBeInTheDocument();
        expect(within(coverage).getByText(/pruned:subject_kind_unsupported/)).toBeInTheDocument();
    });

    it("switches to the degraded scenario and reports partial coverage", async () => {
        const user = userEvent.setup();
        render(<App />);

        await user.click(
            screen.getByRole("button", {
                name: "Which projects are slipping, and how confident can we be in that?",
            }),
        );

        const coverage = screen.getByRole("region", { name: "Coverage" });
        expect(
            within(coverage).getByText(/Partial — some sources did not contribute\./),
        ).toBeInTheDocument();
        expect(within(coverage).getByTitle("stale")).toBeInTheDocument();
        expect(within(coverage).getByTitle("unauthorized")).toBeInTheDocument();
        expect(within(coverage).getByText("endpoint_lookup_failed:2")).toBeInTheDocument();
    });

    it("offers disambiguation candidates without inventing a judgment", async () => {
        const user = userEvent.setup();
        render(<App />);

        await user.click(screen.getByRole("button", { name: "Is Atlas on track?" }));

        const subjects = screen.getByRole("region", { name: "Subjects" });
        expect(
            within(subjects).getByText(
                "Did you mean the Atlas project or the full-chaos/atlas repository?",
            ),
        ).toBeInTheDocument();
        expect(within(subjects).getAllByTitle("ambiguous")).toHaveLength(2);
        expect(within(subjects).getByText("Nothing committed.")).toBeInTheDocument();
        expect(screen.getByText("The service returned no direct judgment.")).toBeInTheDocument();
    });

    it("asks the typed question when the form is submitted", async () => {
        const user = userEvent.setup();
        render(<App />);

        const input = screen.getByLabelText("Ask a question");
        await user.clear(input);
        await user.type(input, "How is the Voyager rewrite going?");
        await user.click(screen.getByRole("button", { name: "Investigate" }));

        expect(screen.getByTestId("scenario-note")).toHaveTextContent("no-match");
        expect(screen.getByText("No evidence was referenced.")).toBeInTheDocument();
    });
});
