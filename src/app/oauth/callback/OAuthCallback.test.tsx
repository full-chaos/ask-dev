import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACR_RETURN_KEY } from "@/lib/acr/browser-host";

const mocks = vi.hoisted(() => ({
    complete: vi.fn(),
    replace: vi.fn(),
}));

vi.mock("@/acr-client", async (original) => ({
    ...(await original<typeof import("@/acr-client")>()),
    completeAcrRedirect: mocks.complete,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import { OAuthCallback } from "./OAuthCallback";

const CALLBACK = "/oauth/callback?code=the-code&state=the-state&iss=http%3A%2F%2Flocalhost%3A8088";
const TOKEN = { kind: "token", token: "t", issuer: "http://localhost:8088" };

beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", CALLBACK);
    mocks.complete.mockReset();
    mocks.replace.mockReset();
});

afterEach(() => {
    window.history.replaceState(null, "", "/");
});

describe("OAuthCallback", () => {
    it("takes the code out of the address before it does anything with it", async () => {
        let addressAtCall = "";
        mocks.complete.mockImplementation(() => {
            addressAtCall = window.location.href;
            return Promise.resolve(TOKEN);
        });
        render(<OAuthCallback />);
        await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
        expect(mocks.complete).toHaveBeenCalledWith(
            "?code=the-code&state=the-state&iss=http%3A%2F%2Flocalhost%3A8088",
        );
        expect(addressAtCall).not.toContain("the-code");
        expect(window.location.search).toBe("");
    });

    it("returns to the page the user asked from, and forgets it", async () => {
        window.sessionStorage.setItem(ACR_RETURN_KEY, "/workbench");
        mocks.complete.mockResolvedValue(TOKEN);
        render(<OAuthCallback />);
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/workbench"));
        expect(window.sessionStorage.getItem(ACR_RETURN_KEY)).toBeNull();
    });

    it("returns to the start with nothing remembered", async () => {
        mocks.complete.mockResolvedValue(TOKEN);
        render(<OAuthCallback />);
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    });

    it.each(["//evil.example", "/\\evil.example", "https://evil.example/"])(
        "does not follow a stored %s",
        async (stored) => {
            window.sessionStorage.setItem(ACR_RETURN_KEY, stored);
            mocks.complete.mockResolvedValue(TOKEN);
            render(<OAuthCallback />);
            await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
        },
    );

    it("says so when the sign-in failed, and stays", async () => {
        window.sessionStorage.setItem(ACR_RETURN_KEY, "/workbench");
        mocks.complete.mockResolvedValue({ kind: "failed", reason: "state_mismatch" });
        render(<OAuthCallback />);
        expect(await screen.findByRole("alert")).toHaveTextContent("could not sign you in");
        expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("spends the code once under strict mode", async () => {
        mocks.complete.mockResolvedValue(TOKEN);
        render(
            <StrictMode>
                <OAuthCallback />
            </StrictMode>,
        );
        await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
        expect(mocks.complete).toHaveBeenCalledTimes(1);
    });
});
