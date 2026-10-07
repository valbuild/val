import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitCompare,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { changesLabel } from "./ProposalSwitcher";

/** One merge check, as the dialog shows it. */
export type MergeCheckView = {
  id: string;
  ok: boolean;
  /** What holds, or what blocks and who. */
  message: string;
};

/**
 * Where Publish is. `docs/proposals.md`, Flow F.
 *
 * `blocked` is not an error: it is the merge checks saying no, and naming who
 * the editor should talk to. `failed` is the merge going wrong after it was
 * pressed, and offers Try again; `error` is the checks themselves not
 * answering, and offers the same.
 */
export type PublishProposalState =
  | { kind: "checking" }
  | {
      kind: "ready";
      checks: MergeCheckView[];
      /** Its changes, saved or not: what goes to the site. */
      changes: number;
      /** Of them, not saved yet: Publish saves them first. */
      unsaved: number;
    }
  | {
      kind: "publishing";
      step: "saving" | "building" | "publishing";
    }
  | {
      kind: "merged";
      /**
       * Where what was written during the merge went: a new proposal, made
       * when the merge landed. Absent when nothing was, or while that is not
       * known yet.
       */
      continuedIn?: { displayName: string; changes: number };
    }
  | { kind: "failed"; message: string }
  | { kind: "error"; message: string };

const STEP_WORDS: Record<
  Extract<PublishProposalState, { kind: "publishing" }>["step"],
  string
> = {
  saving: "Saving the proposal…",
  building: "Building the site with it…",
  publishing: "Publishing…",
};

/** "1 change made during the merge is", "3 changes made during the merge are". */
function changesMadeDuring(changes: number): string {
  return changes === 1
    ? "1 change made during the merge is"
    : `${changes} changes made during the merge are`;
}

/** A message from elsewhere, as a sentence: they do not all end in one. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Publish, in a proposal: merging it into the site. One commit on the site,
 * built and checked before anything changes there; afterwards the proposal is
 * finished, and anything more is a new proposal.
 */
export function PublishProposalDialog({
  open,
  onOpenChange,
  displayName,
  state,
  onPublish,
  onRetry,
  onCompare,
  onGoToSite,
  onOpenContinuation,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  state: PublishProposalState;
  onPublish: () => void;
  /** Ask again: the checks, or the merge, whichever failed. */
  onRetry: () => void;
  /** What will be published, against the site. */
  onCompare?: () => void;
  /** After the merge. Absent when the site's address is not known. */
  onGoToSite?: () => void;
  /** After the merge, when changes made during it went to a new proposal. */
  onOpenContinuation?: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const busy = state.kind === "publishing";
  const blocked =
    state.kind === "ready" && state.checks.some((check) => !check.ok);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Not while it runs: closing would look like stopping it, and it
        // would not stop.
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex flex-col gap-1.5 px-5 pb-3 pt-5">
          <DialogTitle className="text-sm font-semibold">
            {state.kind === "merged"
              ? `Published “${displayName}”`
              : `Publish “${displayName}” to the site`}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            {state.kind === "merged"
              ? "It is live on the site, as one change. This proposal is finished: anything more starts a new one."
              : "Its changes go to the site as one change, checked before anything there changes. The proposal is finished afterwards."}
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-3 px-5 pb-4">
          {state.kind === "checking" && (
            <div className="flex items-center gap-2 text-xs text-fg-secondary">
              <Loader2 size={14} className="animate-spin" /> Checking whether it
              can be published…
            </div>
          )}

          {state.kind === "ready" && (
            <>
              <div className="flex items-center justify-between gap-2 text-xs text-fg-primary">
                <span>
                  {changesLabel(state.changes)}
                  {state.unsaved > 0 && (
                    <span className="text-fg-secondary">
                      {" "}
                      · {state.unsaved} not saved yet, saved first
                    </span>
                  )}
                </span>
                {onCompare !== undefined && (
                  <button
                    type="button"
                    onClick={onCompare}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
                  >
                    <GitCompare size={13} /> Compare
                  </button>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {state.checks.map((check) => (
                  <li
                    key={check.id}
                    className={cn(
                      "flex items-start gap-2 text-xs",
                      check.ok ? "text-fg-secondary" : "text-fg-primary",
                    )}
                  >
                    {check.ok ? (
                      <Check
                        size={14}
                        className="mt-px shrink-0 text-fg-proposal"
                      />
                    ) : (
                      <X
                        size={14}
                        className="mt-px shrink-0 text-fg-error-on-surface"
                      />
                    )}
                    <span>{check.message}</span>
                  </li>
                ))}
              </ul>
              {blocked && (
                <div
                  role="alert"
                  className="rounded-md border border-border-float px-3 py-2 text-xs text-fg-secondary"
                >
                  Ask them to publish or discard those changes first, then
                  publish this. Nothing changed here or on the site.
                </div>
              )}
            </>
          )}

          {state.kind === "publishing" && (
            <div className="flex items-center gap-2 text-xs text-fg-primary">
              <Loader2 size={14} className="animate-spin text-fg-proposal" />
              {STEP_WORDS[state.step]}
            </div>
          )}

          {state.kind === "merged" && (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center gap-2 text-fg-primary">
                <Check size={14} className="text-fg-proposal" /> Merged into the
                site.
              </div>
              {state.continuedIn !== undefined && (
                <div className="pl-[22px] text-fg-secondary">
                  {changesMadeDuring(state.continuedIn.changes)} in a new
                  proposal, “{state.continuedIn.displayName}”.
                </div>
              )}
            </div>
          )}

          {(state.kind === "failed" || state.kind === "error") && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-border-error-primary px-3 py-2 text-xs text-fg-error-on-surface"
            >
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>
                {state.kind === "failed"
                  ? `It was not published: ${asSentence(state.message)} Nothing changed on the site.`
                  : `Could not check whether it can be published: ${asSentence(state.message)}`}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-float px-5 py-3">
          {state.kind === "merged" ? (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-8 rounded-md px-3 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
              >
                Close
              </button>
              {state.continuedIn !== undefined &&
              onOpenContinuation !== undefined ? (
                <>
                  {onGoToSite !== undefined && (
                    <button
                      type="button"
                      onClick={onGoToSite}
                      className="h-8 rounded-md border border-border-float px-3 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
                    >
                      Go to the site
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenContinuation}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
                  >
                    Open “{state.continuedIn.displayName}”{" "}
                    <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                onGoToSite !== undefined && (
                  <button
                    type="button"
                    onClick={onGoToSite}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
                  >
                    Go to the site <ArrowRight size={14} />
                  </button>
                )
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                className="h-8 rounded-md px-3 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary disabled:opacity-50"
              >
                Cancel
              </button>
              {state.kind === "failed" || state.kind === "error" ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="h-8 rounded-md border border-border-float px-3 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
                >
                  Try again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={state.kind !== "ready" || blocked}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
                    "disabled:bg-bg-disabled disabled:text-fg-disabled",
                  )}
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {busy ? "Publishing…" : "Publish"}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
