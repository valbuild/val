import { CircleDot, Cloud, GitBranch, Info, Terminal } from "lucide-react";
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
  deploymentsOpen?: boolean;
  onDeploymentsOpenChange?: (open: boolean) => void;
  /** True when the open list opened itself, which lets it close itself. */
  deploymentsAutoOpened?: boolean;
  onDismissDeployment?: (commitSha: string) => void;
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
  deploymentsOpen = false,
  onDeploymentsOpenChange,
  deploymentsAutoOpened = false,
  onDismissDeployment,
}: StatusBarProps) {
  return (
    <footer
      className={cn(
        "absolute z-full bottom-3 right-3 h-9 flex items-center gap-3 px-3 rounded-lg",
        "bg-bg-float border border-border-float shadow-sm text-xs text-fg-secondary",
        breakpoint === "desktop" ? "left-[4.75rem]" : "left-3",
      )}
    >
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
            Changes are written to your working tree as you type.
          </TooltipContent>
        </Tooltip>
      </label>
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
        {mode === "http" && deployments !== undefined && (
          <>
            <DeploymentsStatus
              deployments={deployments}
              open={deploymentsOpen}
              onOpenChange={onDeploymentsOpenChange ?? (() => undefined)}
              onDismiss={onDismissDeployment ?? (() => undefined)}
              autoClose={deploymentsAutoOpened}
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
  if (saveState === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Cloud size={13} className="text-fg-secondary-alt animate-pulse" />
        Saving…
      </span>
    );
  }
  if (saveState === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-fg-error-on-surface">
        <CircleDot size={13} />
        Could not save
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-bg-brand-secondary" />
      {breakpoint === "tablet" ? "Saved locally" : "All changes saved locally"}
    </span>
  );
}
