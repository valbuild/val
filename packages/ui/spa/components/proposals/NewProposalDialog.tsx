import { ArrowRight, GitBranch, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";

/** What creating answered, when it did not open the new proposal. */
export type NewProposalProblem =
  /**
   * The site as it is now already has an empty proposal. Only from a content
   * service from before every New proposal was a new one.
   */
  | { kind: "exists"; displayName: string; name: string }
  | { kind: "error"; message: string };

/**
 * New proposal. `docs/proposals.md`, Flow B.
 *
 * Starts from the site as it is now, and from nothing else yet: carrying
 * staged changes or an AI session into one arrives with the flows that need
 * them. Every press makes a new proposal, so the Name field comes filled in
 * with `suggestedName` and selected: Create works at once, and typing
 * replaces it.
 */
export function NewProposalDialog({
  open,
  onOpenChange,
  onCreate,
  onOpenExisting,
  suggestedName,
  creating = false,
  problem = null,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { displayName: string; description: string }) => void;
  onOpenExisting: (name: string) => void;
  /** What Name starts as, each time the dialog opens: `randomProposalName`. */
  suggestedName: string;
  creating?: boolean;
  problem?: NewProposalProblem | null;
  portalContainer?: HTMLElement | null;
}) {
  const [displayName, setDisplayName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  /*
   * The suggestion is selected when the field is first focused, so typing
   * replaces it -- once per opening, never again: a name someone has typed
   * is theirs, and coming back to the field must not select it away.
   */
  const selectedSuggestion = useRef(false);
  useEffect(() => {
    if (open) {
      setDisplayName(suggestedName);
      selectedSuggestion.current = false;
    } else {
      setDescription("");
    }
  }, [open, suggestedName]);
  const canCreate = displayName.trim().length > 0 && !creating;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) {
              onCreate({
                displayName: displayName.trim(),
                description: description.trim(),
              });
            }
          }}
        >
          <div className="flex flex-col gap-1 px-5 pb-3 pt-5">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch size={15} className="text-fg-proposal" />
              New proposal
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-secondary">
              A copy of the site you can change and save, with its own address.
              Nothing reaches the site until it is merged.
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-3 px-5 pb-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-primary">Name</span>
              <input
                autoFocus
                onFocus={(event) => {
                  if (selectedSuggestion.current) return;
                  selectedSuggestion.current = true;
                  event.currentTarget.select();
                }}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Spring campaign"
                maxLength={200}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-primary">
                Description{" "}
                <span className="font-normal text-fg-secondary-alt">
                  (optional)
                </span>
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What it changes, and why"
                rows={3}
                className={cn(fieldClass, "h-auto resize-none py-2")}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-primary">
                Starts from
              </span>
              <span className="rounded-md border border-border-float bg-bg-float-raised px-3 py-2 text-xs text-fg-secondary">
                The site as it is now
              </span>
            </div>
            {problem !== null && (
              <div
                role="alert"
                className={cn(
                  "rounded-md border px-3 py-2 text-xs",
                  problem.kind === "exists"
                    ? "border-border-float text-fg-secondary"
                    : "border-border-error-primary text-fg-error-on-surface",
                )}
              >
                {problem.kind === "exists" ? (
                  <>
                    There is already a proposal of the site as it is now:{" "}
                    <button
                      type="button"
                      onClick={() => onOpenExisting(problem.name)}
                      className="font-medium text-fg-primary underline underline-offset-2"
                    >
                      open {problem.displayName}
                    </button>
                    .
                  </>
                ) : (
                  problem.message
                )}
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
              disabled={!canCreate}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
                "disabled:bg-bg-disabled disabled:text-fg-disabled",
              )}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : null}
              {creating ? "Creating…" : "Create and open"}
              {!creating && <ArrowRight size={14} />}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const fieldClass =
  "h-8 w-full rounded-md border border-border-float bg-bg-float-raised px-2.5 text-xs text-fg-primary placeholder:text-fg-secondary-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus";
