import { Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { changesLabel } from "./ProposalSwitcher";

/**
 * Close a proposal: how one is discarded, and always recoverable. Anyone can
 * close anyone's; the owner sees who did. Its changes stay where they are and
 * Reopen brings it back as it was. `docs/proposals.md`, Flow B.
 */
export function CloseProposalDialog({
  open,
  onOpenChange,
  displayName,
  changes,
  onConfirm,
  merging = false,
  closing = false,
  error = null,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  changes: number;
  onConfirm: () => void;
  /** Being published: closing stops that first. */
  merging?: boolean;
  closing?: boolean;
  error?: string | null;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex flex-col gap-1.5 px-5 pb-4 pt-5">
          <DialogTitle className="text-sm font-semibold">
            Close “{displayName}”?
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            {changes === 0
              ? "It has no changes."
              : `Its ${changesLabel(changes)} will not be published.`}{" "}
            You can reopen it from All proposals › Closed.
            {merging &&
              " It is being published: that is stopped first, and nothing reaches the site."}
          </DialogDescription>
          {error !== null && (
            <div
              role="alert"
              className="mt-1 rounded-md border border-border-error-primary px-3 py-2 text-xs text-fg-error-on-surface"
            >
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border-float px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md px-3 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={closing}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
              "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover",
              "disabled:opacity-60",
            )}
          >
            {closing && <Loader2 size={14} className="animate-spin" />}
            {closing ? "Closing…" : "Close proposal"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
