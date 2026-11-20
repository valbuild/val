import { useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { fieldClass } from "./NewProposalDialog";

/**
 * The commit message, asked for where the project requires one
 * (`studio.commitMessage: "required"`): before Commit, and before Publish,
 * which commits first in a project connected to git. Where it is not
 * required, Commit and Publish go without asking.
 */
export function CommitMessageDialog({
  open,
  onOpenChange,
  purpose,
  branch,
  onCommit,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Commit alone, or the commit Publish makes before it merges. */
  purpose: "commit" | "publish";
  /** The proposal's git branch: `val/p/<name>`. */
  branch: string;
  onCommit: (message: string) => void;
  portalContainer?: HTMLElement | null;
}) {
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    setValue("");
    setTried(false);
  }, [open]);
  const message = value.trim();
  const missing = tried && message === "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (message === "") {
              // Marked, with what it takes, and focused: see the error rules.
              setTried(true);
              field.current?.focus();
              return;
            }
            onCommit(message);
          }}
        >
          <div className="flex flex-col gap-1 px-5 pb-3 pt-5">
            <DialogTitle className="text-sm font-semibold">
              {purpose === "commit" ? "Commit" : "Publish to the site"}
            </DialogTitle>
            <DialogDescription className="text-xs text-fg-secondary">
              {purpose === "commit"
                ? `The proposal goes to ${branch} as one commit, for developers to find in git.`
                : `The proposal is committed to ${branch}, then merged into the site.`}
            </DialogDescription>
          </div>
          <div className="flex flex-col gap-1 px-5 pb-4">
            <label
              htmlFor="val-commit-message"
              className="text-xs font-medium text-fg-primary"
            >
              What changed
            </label>
            <textarea
              id="val-commit-message"
              ref={field}
              autoFocus
              rows={3}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={5000}
              aria-invalid={missing}
              aria-describedby="val-commit-message-help"
              className={cn(
                fieldClass,
                "h-auto py-2",
                missing && "border-border-error-primary",
              )}
            />
            <p
              id="val-commit-message-help"
              className={cn(
                "text-[0.6875rem]",
                missing ? "text-fg-error-on-surface" : "text-fg-secondary-alt",
              )}
            >
              {missing
                ? "This project asks for a message on every commit: a sentence about what changed."
                : "A sentence about what changed. This project asks for one on every commit."}
            </p>
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
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
              )}
            >
              {purpose === "commit" ? "Commit" : "Continue"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
