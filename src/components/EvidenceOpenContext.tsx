import { createContext } from "react";

/**
 * CHAOS-12426: what a host that can show one evidence reference gives the answer panels. With it
 * set, `EvidenceReferences` draws each visible reference as a button; with none (the default, and
 * the standalone app) the markup is the plain list. The five panels take no prop for it. The value
 * holds no read: the host does that.
 */
export type EvidenceOpen = {
    open(refId: string, label: string): void;
};

export const EvidenceOpenContext = createContext<EvidenceOpen | null>(null);
