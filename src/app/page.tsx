import Link from "next/link";

import { StandaloneChat } from "@/app/StandaloneChat";
import { AppHeader } from "@/components/shell/AppHeader";

export default function ChatPage() {
    return (
        <div className="app">
            <AppHeader titleIsPageHeading>
                <Link className="app-header__link" href="/workbench">
                    Context Fabric Workbench →
                </Link>
            </AppHeader>
            <main className="app__main">
                <StandaloneChat />
            </main>
        </div>
    );
}
