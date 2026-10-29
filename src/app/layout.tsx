import type { Metadata } from "next";
import localFont from "next/font/local";

import "@/app/tokens.css";
import "@/app/standalone.css";
import "@/app/ask-dev.css";

// Vendored from dev-health-web (src/fonts, OFL): the same static Inter and
// JetBrains Mono instances web loads, under the same CSS variable names.
const bodyFont = localFont({
    src: [
        { path: "../fonts/inter/Inter-400.ttf", weight: "400", style: "normal" },
        { path: "../fonts/inter/Inter-500.ttf", weight: "500", style: "normal" },
        { path: "../fonts/inter/Inter-600.ttf", weight: "600", style: "normal" },
        { path: "../fonts/inter/Inter-700.ttf", weight: "700", style: "normal" },
    ],
    variable: "--font-body",
    display: "swap",
});

const monoFont = localFont({
    src: [
        { path: "../fonts/jetbrains-mono/JetBrainsMono-400.ttf", weight: "400", style: "normal" },
        { path: "../fonts/jetbrains-mono/JetBrainsMono-500.ttf", weight: "500", style: "normal" },
        { path: "../fonts/jetbrains-mono/JetBrainsMono-600.ttf", weight: "600", style: "normal" },
    ],
    variable: "--font-mono",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Ask Dev",
    description: "Ask Dev — conversational access to the ACR Context Fabric.",
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
    return (
        <html className={`${bodyFont.variable} ${monoFont.variable}`} lang="en">
            <body className="ask-dev">{children}</body>
        </html>
    );
}
