import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InspectorRail } from "@/components/chat/InspectorRail";
import { CoveragePanel } from "@/components/CoveragePanel";
import { validateContract } from "@/lib/acr/validate";
import type { InvestigationResult } from "@/lib/contracts";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";

// `window` is `unknown` so a test can build the shapes the rail must tolerate (an
// absent window), not only the ones the generated type allows.
function resultWithWindow(window: unknown): InvestigationResult {
    const result = structuredClone(canonicalResult) as unknown as InvestigationResult;
    return { ...result, effective_evidence_window: window } as InvestigationResult;
}

/** CHAOS-12421: the rail and the Coverage panel read one window the same way. */
describe("the rail and the Coverage panel agree", () => {
    it.each([
        [
            {
                start: "2026-10-01T12:00:00Z",
                end: "2026-10-30T12:00:00Z",
                provenance: "question_stated",
            },
        ],
        [{ relative_id: "trailing_90d", provenance: "server_default" }],
        [{ as_of: "2026-10-30T12:00:00Z", provenance: "server_default" }],
    ])("for %j", (window) => {
        const result = resultWithWindow(window);
        render(<InspectorRail result={result} />);
        render(<CoveragePanel coverage={result.coverage} evidenceWindow={window as never} />);
        const shown = evidenceWindowSection().querySelector(".rail__value")?.textContent ?? "";
        expect(shown).not.toBe("");
        expect(screen.getByTestId("coverage-evidence-window")).toHaveTextContent(shown);
    });
});

function evidenceWindowSection(): HTMLElement {
    const heading = screen.getByRole("heading", { name: "Evidence window" });
    return heading.closest("section") as HTMLElement;
}

describe("InspectorRail evidence window", () => {
    // CHAOS-12202: acr #1791 (CHAOS-11601) answers a current-state question with a
    // snapshot window that carries only `as_of`. It is a reported window, so the
    // rail must show it, never "Not reported".
    it("shows a snapshot window by its as_of date", () => {
        const result = resultWithWindow({
            as_of: "2026-10-30T12:00:00Z",
            provenance: "server_default",
        });
        expect(
            validateContract("context_fabric_investigation_result.v1.schema.json", result).valid,
        ).toBe(true);

        render(<InspectorRail result={result} />);
        const section = within(evidenceWindowSection());
        expect(section.queryByText("Not reported.")).toBeNull();
        expect(section.getByText(/^As of /)).toBeTruthy();
        expect(section.getByText("server default")).toBeTruthy();
    });

    it("prefers the start and end of a bounded window over as_of", () => {
        render(
            <InspectorRail
                result={resultWithWindow({
                    start: "2026-10-01T00:00:00Z",
                    end: "2026-10-30T00:00:00Z",
                    as_of: "2026-10-30T12:00:00Z",
                    provenance: "question_stated",
                })}
            />,
        );
        const section = within(evidenceWindowSection());
        expect(section.queryByText(/^As of /)).toBeNull();
        expect(section.getByText(/–/)).toBeTruthy();
    });

    it("still says Not reported when the result has no window", () => {
        render(<InspectorRail result={resultWithWindow(undefined)} />);
        expect(within(evidenceWindowSection()).getByText("Not reported.")).toBeTruthy();
    });
});
