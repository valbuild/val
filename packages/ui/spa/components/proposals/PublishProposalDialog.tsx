import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitCompare,
  Package,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type { ProposalUpgrade } from "../../proposals/proposalsClient";
import { describeUpgrade } from "./UpgradeProposalNotice";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { changesLabel } from "./ProposalSwitcher";
import { conflictKey, UpdateConflicts } from "./UpdateConflicts";
import { Spinner } from "../designSystem/spinner";

/** One merge check, as the dialog shows it. */
export type MergeCheckView = {
  id: string;
  ok: boolean;
  /** What holds, or what blocks and who. */
  message: string;
  /**
   * What clears it, when something here does. "update-from-site": the site
   * changed under the proposal -- its code (site-code), or a page the proposal
   * changes (published-since) -- and the proposal is brought up to it
   * (valbuild/home `docs/hosted-publishing.md`, step 8). "compute-lockfile":
   * its dependencies changed without a lockfile to match. "typecheck": it
   * has dependencies of its own and no typecheck of what it stages
   * (valbuild/home `docs/adept.md`, step 6 and decision 20).
   */
  action?: "update-from-site" | "compute-lockfile" | "typecheck";
};

/** Something both sides changed, as the person decides it. */
export type UpdateConflictView =
  | {
      kind: "field";
      moduleFilePath: string;
      path: string[];
      site: unknown;
      proposal: unknown;
    }
  | {
      kind: "invalid";
      moduleFilePath: string;
      path: string[];
      message: string;
    }
  | {
      /** A file both changed: a component, or a `.val.ts`'s schema. */
      kind: "code";
      file: string;
      /** Each side's text; `null` where it has no such file. */
      base: string | null;
      site: string | null;
      proposal: string | null;
    };

/**
 * Where Publish is. `docs/proposals.md`, Flow F.
 *
 * `blocked` is not an error: it is the merge checks saying no, and naming who
 * the editor should talk to. `failed` is the merge going wrong after it was
 * pressed, and offers Try again; `error` is the checks themselves not
 * answering, or Update from the site failing, and offers the same when trying
 * again can help.
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
      /** What happened since the dialog opened, said above the checks. */
      note?: string;
      /**
       * Update from the site found these: what both the site and the
       * proposal changed since it started. Decided here, then merged.
       */
      conflicts?: UpdateConflictView[];
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
  | {
      kind: "error";
      message: string;
      /**
       * Update from the site failed, not the checks. `checkId` is the check
       * whose action it was, to try again with; `null` when trying again here
       * cannot help.
       */
      update?: { checkId: string | null };
    };

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

/** "Val 0.149.4 → 0.149.7 and 5 more packages, fixing 2 security issues". */
function upgradeWords(upgrade: ProposalUpgrade): string {
  const { val, others, fixes } = describeUpgrade(upgrade);
  const packages = (count: number) =>
    count === 1 ? "1 package" : `${count} packages`;
  const moved =
    val === null
      ? packages(others)
      : others > 0
        ? `${val} and ${others} more ${others === 1 ? "package" : "packages"}`
        : val;
  return fixes > 0
    ? `${moved}, fixing ${fixes} security ${fixes === 1 ? "issue" : "issues"}`
    : moved;
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
  upgrade,
  siteName,
  state,
  onPublish,
  onRetry,
  onCompare,
  onGoToSite,
  onOpenContinuation,
  onUpdateFromSite,
  onComputeLockfile,
  onTypecheck,
  typechecking = false,
  onResolve,
  onCancelUpdate,
  updating = false,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  /**
   * An upgrade proposal's upgrade: the dialog says what publishing it
   * updates, instead of counting content changes it has none of.
   */
  upgrade?: ProposalUpgrade;
  /** The project's name, "quiet-harbor-24": what an upgrade updates. */
  siteName?: string;
  state: PublishProposalState;
  onPublish: () => void;
  /** Ask again: the checks, the update or the merge, whichever failed. */
  onRetry: () => void;
  /** What will be published, against the site. */
  onCompare?: () => void;
  /** After the merge. Absent when the site's address is not known. */
  onGoToSite?: () => void;
  /** After the merge, when changes made during it went to a new proposal. */
  onOpenContinuation?: () => void;
  /** A check's action: the proposal brought up to the site, for that check. */
  onUpdateFromSite?: (checkId: string) => void;
  /** The dependencies check's action: compute the lockfile. */
  onComputeLockfile?: () => void;
  /** The types check's action: typecheck what the proposal stages. */
  onTypecheck?: () => void;
  /** The typecheck is running. */
  typechecking?: boolean;
  /**
   * The conflicts decided: for each, in order, which side the proposal
   * keeps. Merges the update with those.
   */
  onResolve?: (keep: ("site" | "proposal")[]) => void;
  /** Leave the conflicts undecided: nothing is merged. */
  onCancelUpdate?: () => void;
  /** Updating from the site now. */
  updating?: boolean;
  portalContainer?: HTMLElement | null;
}) {
  const busy = state.kind === "publishing";
  const site = siteName ?? "the site";
  const blocked =
    state.kind === "ready" && state.checks.some((check) => !check.ok);
  // Blocked by someone else's changes, which only they can publish or
  // discard -- not by something an action here clears, and not by the
  // proposal's own dependencies or types, which say what to do themselves.
  const blockedByPeople =
    state.kind === "ready" &&
    state.checks.some(
      (check) =>
        !check.ok &&
        check.action === undefined &&
        check.id !== "dependencies" &&
        check.id !== "types",
    );
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
              : upgrade !== undefined
                ? `Publish “${displayName}” to update ${site}`
                : `Publish “${displayName}” to the site`}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            {upgrade !== undefined
              ? state.kind === "merged"
                ? `It is live: ${site} runs the new packages. This proposal is finished.`
                : `It updates ${site}'s packages: ${upgradeWords(upgrade)}. The site is built and checked with them before anything there changes. The proposal is finished afterwards.`
              : state.kind === "merged"
                ? "It is live on the site, as one change. This proposal is finished: anything more starts a new one."
                : "Its changes go to the site as one change, checked before anything there changes. The proposal is finished afterwards."}
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-3 px-5 pb-4">
          {state.kind === "checking" && (
            <div className="flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner size={14} /> Checking whether it can be published…
            </div>
          )}

          {state.kind === "ready" && (
            <>
              {state.note !== undefined && (
                <p role="status" className="text-xs text-fg-primary">
                  {state.note}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 text-xs text-fg-primary">
                <span>
                  {upgrade === undefined
                    ? changesLabel(state.changes)
                    : state.changes === 0
                      ? "No content changes"
                      : `${changesLabel(state.changes)} to content as well`}
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
              {state.conflicts !== undefined && state.conflicts.length > 0 ? (
                <UpdateConflicts
                  // A new list is new decisions: none carry over by position.
                  key={state.conflicts.map(conflictKey).join("\n")}
                  conflicts={state.conflicts}
                  updating={updating}
                  onResolve={onResolve}
                  onCancel={onCancelUpdate}
                />
              ) : (
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
                      <span className="flex flex-col items-start gap-1.5">
                        <span>{check.message}</span>
                        {!check.ok &&
                          check.action === "update-from-site" &&
                          onUpdateFromSite !== undefined && (
                            <button
                              type="button"
                              onClick={() => onUpdateFromSite(check.id)}
                              disabled={updating}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-proposal px-2 text-xs font-medium text-fg-primary hover:bg-bg-proposal-soft disabled:text-fg-disabled"
                            >
                              {updating ? (
                                <Spinner size={14} />
                              ) : (
                                <ArrowRight size={13} />
                              )}
                              {updating
                                ? "Updating from the site…"
                                : "Update from the site"}
                            </button>
                          )}
                        {!check.ok &&
                          check.action === "compute-lockfile" &&
                          onComputeLockfile !== undefined && (
                            <button
                              type="button"
                              onClick={onComputeLockfile}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-proposal px-2 text-xs font-medium text-fg-primary hover:bg-bg-proposal-soft"
                            >
                              <Package size={13} /> Compute lockfile
                            </button>
                          )}
                        {!check.ok &&
                          check.action === "typecheck" &&
                          onTypecheck !== undefined && (
                            <button
                              type="button"
                              onClick={onTypecheck}
                              disabled={typechecking}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-proposal px-2 text-xs font-medium text-fg-primary hover:bg-bg-proposal-soft disabled:text-fg-disabled"
                            >
                              {typechecking ? (
                                <Spinner size={14} />
                              ) : (
                                <ShieldCheck size={13} />
                              )}
                              {typechecking ? "Typechecking…" : "Typecheck"}
                            </button>
                          )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {blockedByPeople && (
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
              <Spinner size={14} className="text-fg-proposal" />
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
                  : state.update !== undefined
                    ? `Could not update it from the site: ${asSentence(state.message)}`
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
              {state.kind === "failed" ||
              (state.kind === "error" && state.update?.checkId !== null) ? (
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
                  {busy ? <Spinner size={14} /> : <Upload size={14} />}
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
