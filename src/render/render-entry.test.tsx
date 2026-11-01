import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AskDevChat } from "./index";

/**
 * CHAOS-12381: the entry carries the whole three-column shell, not only the answer panels. A host
 * that renders `AskDevChat` from `@full-chaos/ask-dev/render` gets the left rail, the transcript,
 * the pinned composer and the sources rail, under the `.ask-dev` scope its stylesheet needs.
 */
describe("the render entry's shell", () => {
    it("renders the left rail, the transcript, the composer and the sources rail, scoped by .ask-dev", () => {
        const { container } = render(<AskDevChat />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.classList.contains("ask-dev")).toBe(true);
        expect(screen.getByRole("complementary", { name: "This conversation" })).toBeTruthy();
        expect(screen.getByRole("complementary", { name: "Latest answer sources" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Ask Dev conversation" })).toBeTruthy();
        const composer = root.querySelector(".chat__composer-bar");
        expect(composer).not.toBeNull();
        expect(within(composer as HTMLElement).getByRole("button", { name: "Send" })).toBeTruthy();
        // The three columns sit in one grid, in order: left rail, transcript and composer, right rail.
        const columns = [...(root.querySelector(".ask") as HTMLElement).children].map(
            (child) => child.className,
        );
        expect(columns[0]).toContain("ask__rail--left");
        expect(columns.at(-1)).toContain("ask__rail--right");
    });
});
