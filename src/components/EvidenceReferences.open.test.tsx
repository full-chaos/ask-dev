import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EvidenceOpenContext } from "@/components/EvidenceOpenContext";
import { EvidenceReferences } from "@/components/EvidenceReferences";

/** The markup of `EvidenceReferences` with no provider, captured from the base commit (1e667bc). */
const BASE_HTML =
    '<p class="record__meta">Cited</p><ul class="evidence-list"><li class="evidence-ref">Alpha</li><li class="evidence-ref">Evidence</li></ul><details class="details" data-testid="evidence-ref-raw-ids"><summary class="details__summary">Raw evidence ids</summary><div class="details__body"><ul class="evidence-list"><li class="evidence-ref"><code>ref_a</code></li><li class="evidence-ref"><code>ref_b</code></li></ul></div></details>';

const refs = (
    <EvidenceReferences
        evidenceRefIds={["ref_a", "ref_b"]}
        evidenceRefLabels={{ ref_a: "Alpha" }}
        label="Cited"
    />
);

describe("EvidenceReferences with an open context (CHAOS-12426)", () => {
    it("with no provider, the markup is byte-identical to the base and has no button", () => {
        const { container } = render(refs);
        expect(container.innerHTML).toBe(BASE_HTML);
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("with a provider, each visible entry is a button named by its served label, with the floor when none", async () => {
        const open = vi.fn();
        render(
            <EvidenceOpenContext.Provider value={{ open }}>{refs}</EvidenceOpenContext.Provider>,
        );
        const alpha = screen.getByRole("button", { name: "Alpha" });
        const floor = screen.getByRole("button", { name: "Evidence" });
        expect(alpha).toHaveClass("evidence-ref", "evidence-ref--open");
        expect(alpha).toHaveAttribute("type", "button");
        expect(alpha.closest("li")).not.toBeNull();
        await userEvent.click(alpha);
        expect(open).toHaveBeenLastCalledWith("ref_a", "Alpha");
        await userEvent.click(floor);
        expect(open).toHaveBeenLastCalledWith("ref_b", "Evidence");
    });

    it("keeps the raw ids fold unchanged and shows no ref id on the button", () => {
        const { container } = render(
            <EvidenceOpenContext.Provider value={{ open: vi.fn() }}>
                {refs}
            </EvidenceOpenContext.Provider>,
        );
        const fold = container.querySelector('[data-testid="evidence-ref-raw-ids"]')!;
        expect(fold.hasAttribute("open")).toBe(false);
        expect(fold.querySelectorAll("button")).toHaveLength(0);
        expect(fold.textContent).toContain("ref_a");
        for (const button of screen.getAllByRole("button")) {
            expect(button.textContent).not.toContain("ref_");
        }
    });
});
