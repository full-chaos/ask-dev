import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LimitationsPanel } from "@/components/LimitationsPanel";
import { identityLimitations } from "@/lib/fact-dedup";

describe("LimitationsPanel — CHAOS-4669 defect 1 dedup rendering", () => {
    it("renders a non-duplicate limitation's text in full", () => {
        render(
            <LimitationsPanel
                limitations={identityLimitations(["No production adoption evidence."])}
                warnings={[]}
            />,
        );
        expect(screen.getByText("No production adoption evidence.")).toBeInTheDocument();
    });

    it("renders a duplicate limitation as a compact reference, not the full text", () => {
        render(
            <LimitationsPanel
                limitations={[
                    {
                        text: "Release acceptance remains incomplete.",
                        isDuplicate: true,
                        primarySurface: "readiness_gaps",
                    },
                ]}
                warnings={[]}
            />,
        );
        expect(screen.queryByText("Release acceptance remains incomplete.")).toBeNull();
        expect(screen.getByText(/also shown in full under Readiness gaps/i)).toBeInTheDocument();
    });

    /**
     * codex round 3, finding 3 (EXECUTED repro): `DeterministicAnswerView`
     * renders `LimitationsPanel` BEFORE the Findings panels, so a
     * limitation whose primary is `readiness_gaps` (etc.) has not rendered
     * yet at this point on the page — "Already" would be a false
     * positional claim.
     */
    it("never claims the primary was 'already' shown — LimitationsPanel can render above its primary", () => {
        render(
            <LimitationsPanel
                limitations={[
                    {
                        text: "Release acceptance remains incomplete.",
                        isDuplicate: true,
                        primarySurface: "readiness_gaps",
                    },
                ]}
                warnings={[]}
            />,
        );
        expect(screen.queryByText(/already/i)).toBeNull();
    });

    it("still says so explicitly when there are no limitations", () => {
        render(<LimitationsPanel limitations={identityLimitations([])} warnings={[]} />);
        expect(screen.getByText("The service reported no limitations.")).toBeInTheDocument();
    });

    it("still renders warnings, unaffected by dedup", () => {
        render(
            <LimitationsPanel
                limitations={identityLimitations([])}
                warnings={["The cohort ranking is provisional."]}
            />,
        );
        expect(screen.getByText("The cohort ranking is provisional.")).toBeInTheDocument();
    });
});
