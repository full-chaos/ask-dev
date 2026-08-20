import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafeAnswerText } from "@/components/SafeAnswerText";

/**
 * SafeAnswerText (UX-equivalence pass): plain-text-plus-links rendering for
 * the service's own prose fields. See the component's own header for why it
 * stops there — no markdown syntax appears in these fields today.
 */
describe("SafeAnswerText", () => {
    it("renders plain prose with no URL as an ordinary, unmodified text node", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text="Ask Dev is not release-ready." />
            </p>,
        );

        const host = screen.getByTestId("host");
        expect(host).toHaveTextContent("Ask Dev is not release-ready.");
        // No anchor was manufactured for text that carries no URL.
        expect(host.querySelector("a")).toBeNull();
    });

    it("turns a bare https URL into a real, safely-attributed link", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text="See https://example.com/report for the source." />
            </p>,
        );

        const link = screen.getByRole("link", { name: "https://example.com/report" });
        expect(link).toHaveAttribute("href", "https://example.com/report");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer noopener");
        // The surrounding prose survives untouched, on both sides of the link.
        expect(screen.getByTestId("host")).toHaveTextContent(
            "See https://example.com/report for the source.",
        );
    });

    it("strips trailing sentence punctuation from the link, keeping it as text", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text="See https://example.com/report." />
            </p>,
        );

        const link = screen.getByRole("link", { name: "https://example.com/report" });
        expect(link).toHaveAttribute("href", "https://example.com/report");
        expect(screen.getByTestId("host")).toHaveTextContent("See https://example.com/report.");
    });

    it("links every URL when a line carries more than one", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text="Compare https://a.example/x and https://b.example/y." />
            </p>,
        );

        expect(screen.getByRole("link", { name: "https://a.example/x" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "https://b.example/y" })).toBeInTheDocument();
    });

    it("renders the service's own line breaks as real line breaks, not a run-on sentence", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text={"First line.\nSecond line."} />
            </p>,
        );

        const host = screen.getByTestId("host");
        expect(host.querySelectorAll("br")).toHaveLength(1);
        expect(host).toHaveTextContent("First line.Second line.");
    });

    it("never uses dangerouslySetInnerHTML: HTML-looking text stays inert text, not markup", () => {
        render(
            <p data-testid="host">
                <SafeAnswerText text='<img src=x onerror="alert(1)">' />
            </p>,
        );

        const host = screen.getByTestId("host");
        expect(host.querySelector("img")).toBeNull();
        expect(host).toHaveTextContent('<img src=x onerror="alert(1)">');
    });
});
