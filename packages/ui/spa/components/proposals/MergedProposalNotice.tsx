import { ArrowRight, Check, Plus } from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * The Studio at a merged proposal's address. `docs/proposals.md` in
 * valbuild/home, "A merged proposal is finished": it is never built on again,
 * so nothing typed here is kept -- and that is said above the editor, before
 * anyone types, with where to go instead next to it.
 *
 * Where to go is the proposal what was written here during the merge went to,
 * when there is one; otherwise a new proposal. The site is always offered too:
 * that is where what was published is.
 */
export function MergedProposalNotice({
  displayName,
  continuedIn,
  onOpenContinuation,
  onNewProposal,
  onGoToSite,
}: {
  displayName: string;
  /** The proposal its later changes went to, or null when there were none. */
  continuedIn: { displayName: string } | null;
  onOpenContinuation: () => void;
  onNewProposal: () => void;
  /** Absent when the site's address is not known. */
  onGoToSite?: () => void;
}) {
  const title = `“${displayName}” is published`;
  return (
    <section
      role="status"
      aria-label={title}
      className="relative rounded-lg border border-border-proposal bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        <Check size={16} className="mt-0.5 shrink-0 text-fg-proposal" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">{title}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            {continuedIn !== null
              ? `It is live on the site, and finished. What was written here while it was published is in “${continuedIn.displayName}”: carry on there.`
              : "It is live on the site, and finished: nothing more is kept here. To change more, start a new proposal."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {continuedIn !== null ? (
              <button
                type="button"
                onClick={onOpenContinuation}
                className={PRIMARY}
              >
                Open “{continuedIn.displayName}” <ArrowRight size={12} />
              </button>
            ) : (
              <button type="button" onClick={onNewProposal} className={PRIMARY}>
                <Plus size={12} /> New proposal
              </button>
            )}
            {onGoToSite !== undefined && (
              <button
                type="button"
                onClick={onGoToSite}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
                )}
              >
                Go to the site
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const PRIMARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
);
