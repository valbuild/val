import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { fieldClass } from "./NewProposalDialog";

/**
 * Rename a proposal: what people call it. Its name -- the hash its address
 * and branch are made of -- never changes, so links sent around keep working.
 * `docs/proposals.md`, Flow B.
 */
export function RenameProposalDialog({
  open,
  onOpenChange,
  displayName,
  onRename,
  renaming = false,
  error = null,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What it is called now. */
  displayName: string;
  onRename: (displayName: string) => void;
  renaming?: boolean;
  error?: string | null;
  portalContainer?: HTMLElement | null;
}) {
  const [value, setValue] = useState(displayName);
  useEffect(() => {
    if (open) setValue(displayName);
  }, [open, displayName]);
  const next = value.trim();
  const canRename = next.length > 0 && next !== displayName && !renaming;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canRename) onRename(next);
          }}
        >
          <div className="flex flex-col gap-1 px-5 pb-3 pt-5">
            <DialogTitle className="text-sm font-semibold">
              Rename proposal
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-secondary">
              Its address and its link stay the same.
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-3 px-5 pb-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-primary">Name</span>
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={200}
                className={fieldClass}
              />
            </label>
            {error !== null && (
              <div
                role="alert"
                className="rounded-md border border-border-error-primary px-3 py-2 text-xs text-fg-error-on-surface"
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
              type="submit"
              disabled={!canRename}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
                "disabled:bg-bg-disabled disabled:text-fg-disabled",
              )}
            >
              {renaming && <Loader2 size={14} className="animate-spin" />}
              {renaming ? "Renaming…" : "Rename"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
