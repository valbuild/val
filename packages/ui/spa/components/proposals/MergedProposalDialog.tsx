import { ArrowRight, Check, List, Plus } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";

/**
 * The Studio at a merged proposal's address. `docs/proposals.md` in
 * valbuild/home, "A merged proposal is finished": it is never built on again,
 * so there is nothing more to do in it -- nothing saved here is kept, and it
 * cannot be published twice. So it is a dialog that does not close onto the
 * proposal, and offers only the ways out of it.
 *
 * It was a notice above the editor, and later one that popped up from below
 * and could be dismissed. Both left the fields in front of someone who could
 * type into them and lose what they typed, which only a dialog prevents.
 *
 * Where to go is the proposal what was written here during the merge went to,
 * when there is one, else the site, where what was published is. A new
 * proposal and the list of them are always offered.
 */
export function MergedProposalDialog({
  open,
  displayName,
  continuedIn,
  onOpenContinuation,
  onNewProposal,
  onShowAllProposals,
  onGoToSite,
  portalContainer,
}: {
  open: boolean;
  displayName: string;
  /** The proposal its later changes went to, or null when there were none. */
  continuedIn: { displayName: string } | null;
  onOpenContinuation: () => void;
  onNewProposal: () => void;
  onShowAllProposals: () => void;
  /** Absent when the site's address is not known: no button that cannot work. */
  onGoToSite?: () => void;
  portalContainer?: HTMLElement | null;
}) {
  // The way on, as the primary: the continuation, else the site, else a new
  // proposal.
  const primary =
    continuedIn !== null
      ? "continue"
      : onGoToSite !== undefined
        ? "site"
        : "new";
  return (
    // Never closed from here: closing would leave the finished proposal
    // open for typing into. It goes when the Studio does, to wherever was
    // chosen.
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        container={portalContainer}
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex gap-3 px-5 pb-4 pt-5">
          <Check size={18} className="mt-0.5 shrink-0 text-fg-proposal" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-sm font-semibold">
              “{displayName}” is published
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-secondary">
              It is live on the site. This proposal is finished: nothing more
              can be saved or published from it.
              {continuedIn !== null &&
                ` What was written here while it was published is in “${continuedIn.displayName}”: carry on there.`}
            </DialogDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-float px-5 py-3">
          <button type="button" onClick={onShowAllProposals} className={GHOST}>
            <List size={13} /> All proposals
          </button>
          <div className="flex flex-wrap justify-end gap-2">
            {primary !== "new" && (
              <button
                type="button"
                onClick={onNewProposal}
                className={SECONDARY}
              >
                <Plus size={13} /> New proposal
              </button>
            )}
            {primary === "continue" && onGoToSite !== undefined && (
              <button type="button" onClick={onGoToSite} className={SECONDARY}>
                Go to the site
              </button>
            )}
            {primary === "continue" && continuedIn !== null ? (
              <button
                type="button"
                onClick={onOpenContinuation}
                className={PRIMARY}
              >
                Open “{continuedIn.displayName}” <ArrowRight size={13} />
              </button>
            ) : primary === "site" ? (
              <button type="button" onClick={onGoToSite} className={PRIMARY}>
                Go to the site <ArrowRight size={13} />
              </button>
            ) : (
              <button type="button" onClick={onNewProposal} className={PRIMARY}>
                <Plus size={13} /> New proposal
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const BASE =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium";
const PRIMARY = cn(
  BASE,
  "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
);
const SECONDARY = cn(
  BASE,
  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
);
const GHOST = cn(
  BASE,
  "px-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
);
