import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatEvidenceBody } from "@/components/chat/ChatEvidenceBody";
import { formatDay } from "@/lib/evidence-window";
import { CHAT_STATUS_COPY, EVIDENCE_COPY, NOT_RUN_COPY } from "@/render/chat-copy";
import type { ChatEvidenceDetail, ChatEvidenceState } from "@/render/source";

const DETAIL: ChatEvidenceDetail = {
    refId: "ref_secret_id_77",
    citation: "Pull request 482 merged",
    excerpt: "Merged after review.",
    observedAt: "2026-10-01T12:00:00.000Z",
    structuredFields: { marker_zz: true, count: 3 },
};

function body(
    state: ChatEvidenceState,
    extra: { onRetry?: () => void; connect?: React.ReactNode } = {},
) {
    return render(<ChatEvidenceBody state={state} {...extra} />);
}
const root = () => screen.getByTestId("ask-dev-evidence-body");

describe("ChatEvidenceBody states", () => {
    it("loading is a status", () => {
        body({ kind: "loading" });
        expect(root()).toHaveAttribute("data-state", "loading");
        expect(screen.getByRole("status")).toHaveTextContent("Loading this evidence…");
    });

    it("ready shows the citation, excerpt and observed day", () => {
        body({ kind: "ready", detail: DETAIL });
        expect(root()).toHaveAttribute("data-state", "ready");
        expect(screen.getByText("Pull request 482 merged")).toBeInTheDocument();
        expect(screen.getByText("Merged after review.")).toBeInTheDocument();
        expect(root()).toHaveTextContent(`Observed ${formatDay(DETAIL.observedAt!)}`);
        expect(root().textContent).not.toContain(EVIDENCE_COPY.stale);
    });

    it("ready without excerpt or observed day shows only the citation", () => {
        body({ kind: "ready", detail: { refId: "r", citation: "Only this" } });
        expect(root().textContent).not.toContain("Observed");
        expect(screen.getByText("Only this")).toBeInTheDocument();
    });

    it("stale adds the line above the detail", () => {
        body({ kind: "stale", detail: DETAIL });
        expect(root()).toHaveAttribute("data-state", "stale");
        const text = root().textContent ?? "";
        expect(text).toContain("This evidence may be out of date.");
        expect(text.indexOf("This evidence may be out of date.")).toBeLessThan(
            text.indexOf("Pull request 482 merged"),
        );
    });

    it("redacted says part is withheld, then the served reason, then the detail", () => {
        body({ kind: "redacted", reason: "Contains a customer name.", detail: DETAIL });
        expect(root()).toHaveAttribute("data-state", "redacted");
        const text = root().textContent ?? "";
        const a = text.indexOf("Part of this evidence is withheld.");
        const b = text.indexOf("Contains a customer name.");
        const c = text.indexOf("Pull request 482 merged");
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });

    it("redacted with no reason or detail shows the line alone", () => {
        body({ kind: "redacted" });
        expect(root()).toHaveTextContent("Part of this evidence is withheld.");
        expect(root().querySelector("details")).toBeNull();
    });

    it("not_found says nothing of the ref: no id in text or attributes", () => {
        const { container } = body({ kind: "not_found" });
        expect(root()).toHaveAttribute("data-state", "not_found");
        expect(root()).toHaveTextContent("This evidence is not available.");
        expect(container.querySelector("details")).toBeNull();
        expect(container.innerHTML).not.toContain("ref_");
    });

    it("denied uses the access-denied words", () => {
        body({ kind: "denied" });
        expect(root()).toHaveAttribute("data-state", "denied");
        expect(root()).toHaveTextContent(NOT_RUN_COPY.access_denied);
    });

    it("no_repository is its own state with its own words", () => {
        body({ kind: "no_repository" });
        expect(root()).toHaveAttribute("data-state", "no_repository");
        expect(root()).toHaveTextContent(NOT_RUN_COPY.no_repository);
        expect(root().textContent).not.toContain(NOT_RUN_COPY.access_denied);
        expect(root().textContent).not.toContain("could not be read");
    });

    it("unavailable offers Try again only with onRetry", async () => {
        const { unmount } = body({ kind: "unavailable" });
        expect(root()).toHaveAttribute("data-state", "unavailable");
        expect(root()).toHaveTextContent("This evidence could not be read.");
        expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
        unmount();
        const onRetry = vi.fn();
        body({ kind: "unavailable" }, { onRetry });
        await userEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("connect shows the connect words and the host's node", () => {
        body({ kind: "connect" }, { connect: <button type="button">Host connect</button> });
        expect(root()).toHaveAttribute("data-state", "connect");
        expect(root()).toHaveTextContent(CHAT_STATUS_COPY.connect);
        expect(screen.getByRole("button", { name: "Host connect" })).toBeInTheDocument();
    });
});

describe("ChatEvidenceBody raw values and served text", () => {
    it("holds the ref id and structured fields only inside a closed Details fold", () => {
        const { container } = body({ kind: "ready", detail: DETAIL });
        const fold = container.querySelector("details")!;
        expect(fold).not.toBeNull();
        expect(fold.hasAttribute("open")).toBe(false);
        expect(fold.querySelector("summary")).toHaveTextContent("Details");
        expect(fold.querySelector("code")).toHaveTextContent("ref_secret_id_77");
        expect(fold.querySelector("pre")?.textContent).toBe(
            JSON.stringify(DETAIL.structuredFields, null, 2),
        );
        const outside = container.cloneNode(true) as HTMLElement;
        outside.querySelector("details")!.remove();
        expect(outside.textContent).not.toContain("ref_secret_id_77");
        expect(outside.textContent).not.toContain("marker_zz");
    });

    it("has no fold when the detail has no structured fields beyond the id? it still folds the id", () => {
        const { container } = body({ kind: "ready", detail: { refId: "ref_x", citation: "c" } });
        expect(container.querySelector("details code")).toHaveTextContent("ref_x");
        expect(container.querySelector("details pre")).toBeNull();
    });

    it("renders served markup as text", () => {
        const { container } = body({
            kind: "ready",
            detail: {
                refId: "r",
                citation: "<img src=x onerror=alert(1)>",
                excerpt: "<b>bold</b>",
            },
        });
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("b")).toBeNull();
        expect(root().textContent).toContain("<img src=x onerror=alert(1)>");
        expect(root().textContent).toContain("<b>bold</b>");
    });

    it("wraps its own root in .ask-dev", () => {
        body({ kind: "loading" });
        expect(root().closest(".ask-dev")).not.toBeNull();
    });
});
