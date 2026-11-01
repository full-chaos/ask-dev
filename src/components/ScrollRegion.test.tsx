import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactTable } from "@/components/FactTable";
import { ScrollRegion } from "@/components/ScrollRegion";
import canonicalResult from "@/contracts/examples/context_fabric_investigation_result.v1.json";
import type { InvestigationResult } from "@/lib/contracts";

const components = path.join(process.cwd(), "src/components");

describe("ScrollRegion", () => {
    it("takes focus and has a name, so a keyboard can scroll it (axe scrollable-region-focusable)", () => {
        render(<ScrollRegion label="Facts">table</ScrollRegion>);

        const region = screen.getByRole("group", { name: "Facts" });
        expect(region).toHaveAttribute("tabindex", "0");
        expect(region).toHaveClass("fact-table-wrap");
    });

    it("is a group, not a landmark: a conversation has many, and landmarks must be unique", () => {
        render(<ScrollRegion label="Facts">table</ScrollRegion>);

        expect(screen.queryByRole("region")).toBeNull();
    });

    it("wraps a fact table", () => {
        const result = canonicalResult as unknown as InvestigationResult;
        render(<FactTable rows={result.claimed_facts?.[0]?.rows ?? []} />);

        expect(screen.getByRole("group", { name: "Facts" })).toContainElement(
            screen.getByRole("table"),
        );
    });

    it("is the only place that sets the scrolling class", () => {
        const sources = readdirSync(components, { recursive: true, encoding: "utf8" }).filter(
            (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
        );
        expect(sources.length).toBeGreaterThan(10);

        const setting = sources.filter((name) =>
            readFileSync(path.join(components, name), "utf8").includes('"fact-table-wrap"'),
        );

        expect(setting).toEqual(["ScrollRegion.tsx"]);
    });
});

describe("the pending pulse", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/ask-dev.css"), "utf8");

    it("moves the dot, never the words: text at 0.6 opacity fails contrast", () => {
        const rule = /([^\n{}]+)\{\s*animation: ask-dev-pending-pulse/u.exec(css);

        expect(rule?.[1]?.trim()).toBe(".chat__pending::before");
    });
});
