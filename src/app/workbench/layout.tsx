import type { Metadata } from "next";

// Route-scoped metadata (Next.js merges this over the root layout's for every
// page under /workbench). The root layout now carries the chat surface's own
// title, so the Workbench keeps its own identity here instead of losing it.
export const metadata: Metadata = {
    title: "Context Fabric Workbench",
    description: "Standalone answer test platform for the ACR Context Fabric.",
};

export default function WorkbenchLayout({ children }: { readonly children: React.ReactNode }) {
    return <>{children}</>;
}
