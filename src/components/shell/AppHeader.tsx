import Image from "next/image";
import Link from "next/link";

import fcLogo from "@/assets/fc-logo.svg";

export type AppHeaderProps = {
    /** The chat page owns the "Ask Dev" h1; any other page keeps its own. */
    readonly titleIsPageHeading: boolean;
    readonly children?: React.ReactNode;
};

/**
 * Standalone chrome only. An embedding host (dev-health-web's AppShell)
 * brings its own brand, navigation and scope bar, and never mounts this.
 */
export function AppHeader({ titleIsPageHeading, children }: AppHeaderProps) {
    const Title = titleIsPageHeading ? "h1" : "span";
    return (
        <header className="app-header">
            <Link className="app-header__brand" href="/">
                <Image
                    alt=""
                    className="app-header__logo"
                    height={29}
                    priority
                    src={fcLogo}
                    width={30}
                />
                <span className="app-header__wordmark">
                    <span className="app-header__product">Dev Health</span>
                    <Title className="app-header__title">Ask Dev</Title>
                </span>
            </Link>
            {children === undefined ? null : (
                <nav aria-label="Ask Dev" className="app-header__nav">
                    {children}
                </nav>
            )}
        </header>
    );
}
