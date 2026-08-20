import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
    title: "Ask Dev",
    description: "Ask Dev — conversational access to the ACR Context Fabric.",
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
