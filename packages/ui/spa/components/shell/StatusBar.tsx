import {
  CircleDot,
  Cloud,
  ExternalLink,
  GitBranch,
  Info,
  Terminal,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { Checkbox } from "../designSystem/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { ShellBreakpoint } from "./types";

export type SaveState = "saved" | "saving" | "error";

export type StatusBarProps = {
  breakpoint: ShellBreakpoint;
  saveState: SaveState;
  isDevMode: boolean;
  autoSave: boolean;
  onAutoSaveChange: (autoSave: boolean) => void;
  branch: string;
  repositoryUrl: string;
};

/**
 * The floating bottom status bar: everything about *where* changes go, and
 * nothing about the content itself.
 *
 * Hidden on mobile, where the same information moves into the status sheet
 * behind the bottom bar's info button rather than eating a permanent row.
 */
export function StatusBar({
  breakpoint,
  saveState,
  isDevMode,
  autoSave,
  onAutoSaveChange,
  branch,
  repositoryUrl,
}: StatusBarProps) {
  return (
    <footer
      className={cn(
        "absolute z-full bottom-3 right-3 h-9 flex items-center gap-3 px-3 rounded-lg",
        "bg-bg-float border border-border-float shadow-sm text-xs text-fg-secondary",
        breakpoint === "desktop" ? "left-[4.75rem]" : "left-3",
      )}
    >
      <SaveIndicator saveState={saveState} />
      <Divider />
      {isDevMode && (
        <>
          <span className="inline-flex items-center gap-1.5">
            <Terminal size={13} className="text-fg-secondary-alt" />
            Dev mode
          </span>
          <Divider />
        </>
      )}
      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
        <Checkbox
          checked={autoSave}
          onCheckedChange={(checked) => onAutoSaveChange(checked === true)}
          className="w-3.5 h-3.5"
        />
        Auto save
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-fg-secondary-alt">
              <Info size={12} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Changes are written to your working tree as you type.
          </TooltipContent>
        </Tooltip>
      </label>
      <div className="ml-auto flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <GitBranch size={13} className="text-fg-secondary-alt" />
          {branch}
        </span>
        <Divider />
        <a
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-fg-primary"
        >
          <span className="hidden md:inline">View on GitHub</span>
          <span className="md:hidden">GitHub</span>
          <ExternalLink size={12} />
        </a>
      </div>
    </footer>
  );
}

function Divider() {
  return <span aria-hidden className="w-px h-4 bg-border-float" />;
}

export function SaveIndicator({ saveState }: { saveState: SaveState }) {
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
      <span className="inline-flex items-center gap-1.5 text-fg-error-secondary">
        <CircleDot size={13} />
        Could not save
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-bg-brand-secondary" />
      All changes saved locally
    </span>
  );
}
