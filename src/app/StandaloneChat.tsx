"use client";

import { useMemo } from "react";

import { AskDevChat } from "@/components/chat/AskDevChat";
import { investigateFromBrowser } from "@/lib/acr/investigate";
import { createStandaloneSource } from "@/render/standalone-source";

/**
 * The standalone chat: one source per mount, over the browser's own ACR call (CHAOS-12106). A
 * client component, because the source holds the conversation and the call needs the browser.
 */
export function StandaloneChat() {
    const source = useMemo(() => createStandaloneSource(investigateFromBrowser), []);
    return <AskDevChat source={source} />;
}
