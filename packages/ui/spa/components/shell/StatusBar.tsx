import type { ReactNode } from "react";
import { CircleDot, Cloud, GitBranch, Info, Terminal } from "lucide-react";
import {
  isInFlight,
  type PublishIndicator,
} from "../../publish/publishIndicatorView";
import { cn } from "../designSystem/cn";
import { Checkbox } from "../designSystem/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { DeploymentsStatus } from "./Deployments";
import { ShellBreakpoint, ShellDeployment } from "./types";

export type SaveState = "saved" | "saving" | "error";

export type StatusBarProps = {
  breakpoint: ShellBreakpoint;
  saveState: SaveState;
  /**
   * How Val is running: against the working copy on disk, or against a
   * project.
   *
   * Decides two things at once, because they are the same fact. On disk there
   * is nothing to deploy — publishing writes files — so the deploy item would
   * only ever say "no deploys", and the bar says "Dev mode" instead so it is
   * clear where the work is going. Against a project the deployments *are* that
   * answer, and a label repeating the mode next to them says nothing.
   *
   * `unknown` until the client has been told, and then neither is shown: a
   * "Dev mode" that appears for a moment on a project and then vanishes is
   * worse than a bar that fills in a beat late.
   */
  mode?: "fs" | "http" | "unknown";
  autoSave: boolean;
  onAutoSaveChange: (autoSave: boolean) => void;
  /** From `config.gitBranch`; hidden when Val is not in a git checkout. */
  branch?: string;
  /** Publishes in flight or recently finished. Hidden when there is no feed. */
  deployments?: ShellDeployment[];
  /** See `ShellData.studioIsDeployer`. */
  studioIsDeployer?: boolean;
  /**
   * Whether the site is still on its way to what was published, by anyone.
   * See `publishIndicator`. Without one, the deploy feed's own summary.
   */
  publishIndicator?: PublishIndicator;
  deploymentsOpen?: boolean;
  onDeploymentsOpenChange?: (open: boolean) => void;
  /**
   * Something wrong with the setup that the editor has dismissed but not
   * fixed, e.g. `UploadsOffChip`. First on the right, before the build and the
   * environment: it is the one item here that asks for something.
   */
  notice?: ReactNode;
};

/**
 * The floating bottom status bar: everything about *where* changes go, and
 * nothing about the content itself.
 *
 * It is read left to right as a pipeline. The left is what you have set up
 * and rarely touch — auto save, the branch you are writing to. The right is
 * what is happening to your work right now — the build, the environment, and
 * whether the last keystroke made it to disk. The rightmost slot is the one
 * that changes most often, so that is where the save state sits.
 *
 * Hidden on mobile, where the same information moves into the status sheet
 * behind the bottom bar's info button rather than eating a permanent row.
 */
export function StatusBar({
  breakpoint,
  saveState,
  mode,
  autoSave,
  onAutoSaveChange,
  branch,
  deployments,
  studioIsDeployer = false,
  publishIndicator,
  deploymentsOpen = false,
  onDeploymentsOpenChange,
  notice,
}: StatusBarProps) {
  return (
    <footer
      className={cn(
        "absolute z-full bottom-3 right-3 h-9 flex items-center gap-3 px-3 rounded-lg",
        "bg-bg-float border border-border-float shadow-sm text-xs text-fg-secondary",
        breakpoint === "desktop" ? "left-[4.75rem]" : "left-3",
      )}
    >
      {/*
        `fs` only. Auto save writes the working tree on a pause in typing; in
        `http` mode publishing makes a commit, which is not something to do
        without being asked. Same rule the deploy feed and "Dev mode" already
        follow here.
      */}
      {mode === "fs" && (
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <Checkbox
            checked={autoSave}
            onCheckedChange={(checked) => onAutoSaveChange(checked === true)}
            className="w-3.5 h-3.5"
          />
          Auto save
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden lg:inline text-fg-secondary-alt">
                <Info size={12} />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Changes are written to your working tree on a pause in typing.
            </TooltipContent>
          </Tooltip>
        </label>
      )}
      {branch && (
        <>
          <Divider />
          <span className="inline-flex items-center gap-1.5 font-mono">
            <GitBranch size={13} className="text-fg-secondary-alt" />
            {branch}
          </span>
        </>
      )}
      <div className="ml-auto flex items-center gap-3">
        {notice && (
          <>
            {notice}
            <Divider />
          </>
        )}
        {/*
          With no deploy feed there is no list and no resting state to show,
          but a publish under way, or one that failed, is still news: the
          indicator shows for that alone, over an empty list.
        */}
        {mode === "http" &&
          (deployments !== undefined ||
            (publishIndicator !== undefined &&
              (isInFlight(publishIndicator) ||
                publishIndicator.kind === "failed"))) && (
            <>
              <DeploymentsStatus
                deployments={deployments ?? []}
                studioIsDeployer={studioIsDeployer}
                indicator={publishIndicator}
                open={deploymentsOpen}
                onOpenChange={onDeploymentsOpenChange ?? (() => undefined)}
              />
              <Divider />
            </>
          )}
        {mode === "fs" && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Terminal size={13} className="text-fg-secondary-alt" />
              Dev mode
            </span>
            <Divider />
          </>
        )}
        <SaveIndicator saveState={saveState} breakpoint={breakpoint} />
      </div>
    </footer>
  );
}

function Divider() {
  return <span aria-hidden className="w-px h-4 bg-border-float" />;
}

export function SaveIndicator({
  saveState,
  breakpoint,
}: {
  saveState: SaveState;
  breakpoint?: ShellBreakpoint;
}) {
  /*
   * One width for every state.
   *
   * The indicator is the rightmost thing in a right-aligned row, so when its
   * text changed length everything to its left moved: "Dev mode", the
   * deployments, the dividers all jumped sideways each time "All changes
   * saved" became "Saving…" and back. Every label is laid into the same grid
   * cell, the inactive ones invisible, so the slot is as wide as the widest of
   * them and only the words inside it change.
   */
  return (
    <span className="inline-grid justify-items-end">
      {SAVE_STATES.map((state) => (
        <span
          key={state}
          aria-hidden={state !== saveState}
          className={cn(
            "col-start-1 row-start-1",
            state !== saveState && "invisible",
          )}
        >
          <SaveLabel saveState={state} breakpoint={breakpoint} />
        </span>
      ))}
    </span>
  );
}

const SAVE_STATES: SaveState[] = ["saved", "saving", "error"];

function SaveLabel({
  saveState,
  breakpoint,
}: {
  saveState: SaveState;
  breakpoint?: ShellBreakpoint;
}) {
  if (saveState === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <SaveIcon>
          <Cloud size={13} className="text-fg-secondary-alt animate-pulse" />
        </SaveIcon>
        Saving…
      </span>
    );
  }
  if (saveState === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-fg-error-on-surface">
        <SaveIcon>
          <CircleDot size={13} />
        </SaveIcon>
        Could not save
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <SaveIcon>
        <span className="w-1.5 h-1.5 rounded-full bg-bg-brand-secondary" />
      </SaveIcon>
      {/*
       * Not "saved locally".
       *
       * It said that at every breakpoint and in every mode, and against a
       * project it is simply wrong: the patch is on the content service, which
       * is where it has to be for a colleague to see it and for Publish to ship
       * it. "Locally" reads as "still only on this machine", which is the one
       * thing an editor would want to know and the opposite of what is true.
       *
       * It is not worth saying in dev either. There the bar already says "Dev
       * mode" two items to the left, and the branch beside it - "locally" adds
       * a word to a sentence whose subject is already answered.
       */}
      {breakpoint === "tablet" ? "Saved" : "All changes saved"}
    </span>
  );
}

/**
 * The icon's box, the same size whichever icon is in it — the saved dot is a
 * quarter of the cloud's width, so without it the words moved too.
 */
function SaveIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[13px] shrink-0 place-items-center">
      {children}
    </span>
  );
}
