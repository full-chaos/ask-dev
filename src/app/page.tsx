import Link from "next/link";

import { AskDevChat } from "@/components/chat/AskDevChat";
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
                <AskDevChat />
            </main>
        </div>
    );
}
