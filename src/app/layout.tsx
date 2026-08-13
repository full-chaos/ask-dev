import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
    title: "Context Fabric Workbench",
    description: "Standalone answer test platform for the ACR Context Fabric.",
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
