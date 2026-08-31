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
        expect(screen.getByText(/already shown in full under Readiness gaps/i)).toBeInTheDocument();
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
