import type { CarriedStructureReceipt } from "@/lib/structure-carry";
import { structureMemberLabel } from "@/lib/structure-disposition";

export type CarriedStructureNoticeProps = {
    /**
     * The carry contribution that rode along on THIS turn's own request —
     * i.e. every member `structure-carry.ts` injected that the tester did
     * not pick this turn. `undefined`/empty renders nothing, same as
     * `StructureConfirmationNotice` when there is nothing to say.
     */
    readonly entries: readonly CarriedStructureReceipt[] | undefined;
};

/**
 * CHAOS-4355 stopgap disclosure: names which structure members this turn's
 * request carried FORWARD from an earlier turn's own confirmation, rather
 * than from anything the tester picked this turn.
 *
 * ACR does not carry a confirmed structure member across re-asks
 * server-side yet (CHAOS-4360 is the real fix) — the Workbench does it
 * client-side instead (`structure-carry.ts`). That is silent by
 * construction unless disclosed: a tester who never re-picked the window
 * would otherwise have no way to tell "ACR remembered" from "the
 * Workbench quietly resent it for you". Low-emphasis on purpose (a
 * caption, not an alert) — this is provenance, not a warning; nothing was
 * vetoed or dropped, which is what `StructureConfirmationNotice` is for.
 *
 * Dark-theme rule: `.record__meta` is the same low-alpha caption class
 * `StructureConfirmationNotice` already uses for its own meta line — no
 * new border, no new color token.
 */
export function CarriedStructureNotice({ entries }: CarriedStructureNoticeProps) {
    if (entries === undefined || entries.length === 0) return null;
    return (
        <p className="record__meta" data-testid="carried-structure-notice">
            {entries
                .map(
                    (entry) =>
                        `${structureMemberLabel(entry.member)} carried from turn ${String(entry.turn)}`,
                )
                .join(" · ")}
        </p>
    );
}
