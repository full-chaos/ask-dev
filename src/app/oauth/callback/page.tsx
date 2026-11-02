import type { Metadata } from "next";

import { OAuthCallback } from "./OAuthCallback";

// The URL carries a one-time code. Never send it on as a referrer, and keep the page out of
// search (CHAOS-12106).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Signing in",
    referrer: "no-referrer",
    robots: { index: false, follow: false, nocache: true },
};

export default function OAuthCallbackPage() {
    return <OAuthCallback />;
}
