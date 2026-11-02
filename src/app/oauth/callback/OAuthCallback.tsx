"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { completeAcrRedirect } from "@/acr-client";
import { ACR_RETURN_KEY, safeReturnPath } from "@/lib/acr/browser-host";

/**
 * Where ACR sends the tab back to (CHAOS-12106). It scrubs the one-time code from the address,
 * finishes the exchange, and returns the user to the page they asked from.
 */
export function OAuthCallback() {
    const router = useRouter();
    const [failed, setFailed] = useState(false);
    // The effect runs twice in development; the code can be used once.
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const search = window.location.search;
        // The code is single use and secret to this tab: it leaves the address bar first.
        window.history.replaceState(null, "", window.location.pathname);
        void completeAcrRedirect(search).then((outcome) => {
            if (outcome.kind !== "token") {
                setFailed(true);
                return;
            }
            let target = "/";
            try {
                target = safeReturnPath(window.sessionStorage.getItem(ACR_RETURN_KEY)) ?? "/";
                window.sessionStorage.removeItem(ACR_RETURN_KEY);
            } catch {
                // No storage: back to the start.
            }
            // A client-side move keeps the access token, which lives in this page's memory.
            router.replace(target);
        });
    }, [router]);

    return (
        <main className="workbench">
            {failed ? (
                <p className="panel__empty" role="alert">
                    Ask Dev could not sign you in. <Link href="/">Back to Ask Dev</Link>
                </p>
            ) : (
                <p className="panel__empty" role="status">
                    Signing you in to Ask Dev.
                </p>
            )}
        </main>
    );
}
