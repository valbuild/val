import {
  AlertTriangle,
  ExternalLink,
  Hammer,
  GitCompare,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import type { StudioLocation } from "./types";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;

/**
 * What the top bar does in a proposal. `docs/proposals.md`, Flow B.
 *
 * Save commits the proposal's changes, and its address serves them on the
 * next request; it is never a publish and never a push. Publish is the
 * proposal's way to the site -- merging it -- and saves first when there is
 * something unsaved, because only what was saved is ever published. What it
 * will publish is what Review shows: the proposal against the site.
 *
 * A save that failed says so on the button, as a failed publish does on the
 * site's.
 */
export function ProposalSaveButton({
  location,
  onSave,
  blockedBy,
  className,
}: {
  location: InProposal;
  onSave: () => void;
  /**
   * Validation errors a save would be refused for. With unsaved changes the
   * button is "Fix N" and goes to them, as the site's Publish is -- pressing
   * Save only to be told the content is invalid was the alternative.
   */
  blockedBy?: { errors: number; onShow: () => void };
  className?: string;
}) {
  const saving = location.save.state === "saving";
  const failed = location.save.state === "failed" ? location.save : null;
  const blocked =
    !saving &&
    location.unsaved > 0 &&
    blockedBy !== undefined &&
    blockedBy.errors > 0
      ? blockedBy
      : null;
  const canSave = location.unsaved > 0 && !saving;
  return (
    <button
      type="button"
      onClick={blocked !== null ? blocked.onShow : onSave}
      disabled={!canSave}
      title={
        blocked !== null
          ? `${blocked.errors} validation ${blocked.errors === 1 ? "error" : "errors"} to fix before saving. Press to see ${blocked.errors === 1 ? "it" : "them"}.`
          : failed !== null
            ? `${failed.error}. Press to try again.`
            : undefined
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        failed !== null || blocked !== null
          ? "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      {saving ? (
        <Loader2 size={14} className="shrink-0 animate-spin" />
      ) : failed !== null || blocked !== null ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : (
        <Save size={14} className="shrink-0" />
      )}
      <span className="truncate">
        {saving
          ? "Saving…"
          : blocked !== null
            ? `Fix ${blocked.errors > 9 ? "9+" : blocked.errors}`
            : failed !== null
              ? "Save failed"
              : "Save"}
      </span>
      {!saving &&
        failed === null &&
        blocked === null &&
        location.unsaved > 0 && (
          <span className="tabular-nums opacity-80">{location.unsaved}</span>
        )}
    </button>
  );
}

/**
 * Build, in a proposal with staged files: what makes its address show them
 * (valbuild/home `docs/hosted-publishing.md`, step 7). Shown only while there
 * is something to build -- "Build required" is the button itself -- and a
 * failed build says so on it, with the reason, and builds again when pressed.
 */
export function ProposalBuildButton({
  location,
  onBuild,
  className,
}: {
  location: InProposal;
  onBuild: () => void;
  className?: string;
}) {
  const code = location.code;
  if (code === null) return null;
  const building = code.state === "building";
  const blocked = code.state === "blocked";
  const failed = code.state === "failed" ? code : null;
  return (
    <button
      type="button"
      onClick={onBuild}
      disabled={building}
      title={
        failed !== null
          ? `The build failed: ${failed.error}. Press to build again.`
          : building
            ? "Building the proposal's code, so its preview shows it."
            : blocked
              ? "This browser builds the proposal in a new tab, and did not let it open. Press to open it."
              : "Code has changed in this proposal. Build it so the preview shows the change."
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium",
        failed !== null
          ? "border-transparent bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "border-border-proposal text-fg-primary hover:bg-bg-proposal-soft",
        "disabled:text-fg-disabled",
        className,
      )}
    >
      {building ? (
        <Loader2 size={14} className="shrink-0 animate-spin" />
      ) : failed !== null ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : blocked ? (
        <ExternalLink size={14} className="shrink-0" />
      ) : (
        <Hammer size={14} className="shrink-0" />
      )}
      <span className="truncate">
        {building
          ? "Building…"
          : failed !== null
            ? "Build failed"
            : blocked
              ? "Open the tab to build"
              : "Build required"}
      </span>
    </button>
  );
}

/**
 * Publish, in a proposal: merging it into the site. It sits beside the
 * switcher, because it is about the proposal named there, and wears the
 * proposal's colour rather than the site's green.
 */
export function ProposalPublishButton({
  location,
  onPublish,
  className,
}: {
  location: InProposal;
  onPublish: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={location.publishBlockedBy !== null}
      title={
        location.publishBlockedBy ??
        (location.unsaved > 0
          ? "Saves the proposal, then publishes it to the site"
          : "Publishes the proposal to the site")
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        // Not the site's green: that is the site's Publish. The proposal's
        // colour, outlined, so it belongs to the switcher it sits beside and
        // stays quieter than Save, which is pressed far more often.
        "border border-border-proposal text-fg-proposal hover:bg-bg-proposal-soft",
        "disabled:border-border-float disabled:bg-transparent disabled:text-fg-disabled",
        className,
      )}
    >
      <Upload size={14} className="shrink-0" />
      <span className="truncate">Publish</span>
    </button>
  );
}

/**
 * The proposal's own menu, above a phone: compare, rename, copy its link,
 * close. On a phone the same acts are in `ProposalSheet`.
 */
export function ProposalMenu({
  onCompare,
  onRename,
  onCopyLink,
  onClose,
  defaultOpen = false,
  menuPlacement = "below",
}: {
  /** Absent: not offered. */
  onCompare?: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  defaultOpen?: boolean;
  menuPlacement?: "below" | "above";
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);
  const choose = (action: () => void) => () => {
    setIsOpen(false);
    action();
  };
  return (
    <div ref={containerRef} className="relative h-8 shrink-0">
      <button
        type="button"
        aria-label="More for this proposal"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="grid h-8 w-8 place-items-center rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-full w-56 rounded-md border border-border-float bg-bg-float py-1 shadow-lg",
            menuPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {onCompare !== undefined && (
            <MenuItem
              icon={<GitCompare size={14} />}
              onClick={choose(onCompare)}
            >
              Compare with the site
            </MenuItem>
          )}
          <MenuItem icon={<Pencil size={14} />} onClick={choose(onRename)}>
            Rename…
          </MenuItem>
          <MenuItem icon={<Link2 size={14} />} onClick={choose(onCopyLink)}>
            Copy link
          </MenuItem>
          <div className="my-1 border-t border-border-float" />
          <MenuItem
            icon={<X size={14} />}
            onClick={choose(onClose)}
            destructive
          >
            Close…
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  destructive = false,
  disabled = false,
  detail,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-float-raised disabled:hover:bg-transparent",
        destructive
          ? "text-fg-error-on-surface"
          : disabled
            ? "text-fg-disabled"
            : "text-fg-primary",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center pt-0.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {detail !== undefined && (
          <span className="block text-[0.6875rem] text-fg-secondary-alt">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}
