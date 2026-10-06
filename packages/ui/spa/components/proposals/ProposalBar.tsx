import {
  AlertTriangle,
  Check,
  ChevronRight,
  GitCompare,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import type { StudioLocation } from "./types";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;

/**
 * What the top bar does in a proposal: where Publish is on the site.
 * `docs/proposals.md`, Flow B, "Inside a proposal".
 *
 * Save, Merge and a menu, and nothing else. Save commits the proposal's
 * changes and its address serves them on the next request; it is never a
 * merge and never a push. Merge is shown and disabled with its reason until
 * merging exists -- with unsaved changes it reads "Save and merge", because a
 * merge only ever ships what was saved.
 *
 * The status beside them says what the proposal is doing, most urgent first:
 * a save that failed, a save running, the address being made or brought up to
 * date, and then whether it rendered after the last save. A render that
 * failed is a report, never a gate: it blocks nothing.
 */
export function ProposalBar({
  location,
  onSave,
  onMerge,
  onCompare,
  onRename,
  onCopyLink,
  onClose,
  onRetrySetup,
  defaultMenuOpen = false,
}: {
  location: InProposal;
  onSave: () => void;
  onMerge: () => void;
  onCompare: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  onRetrySetup: () => void;
  /** For stories: show the menu open. */
  defaultMenuOpen?: boolean;
}) {
  const saving = location.save.state === "saving";
  const canSave = location.unsaved > 0 && !saving;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ProposalStatus location={location} onRetrySetup={onRetrySetup} />
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
          "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
          "disabled:bg-bg-disabled disabled:text-fg-disabled",
        )}
      >
        {saving ? (
          <Loader2 size={14} className="shrink-0 animate-spin" />
        ) : (
          <Save size={14} className="shrink-0" />
        )}
        <span>{saving ? "Saving…" : "Save"}</span>
        {!saving && location.unsaved > 0 && (
          <span className="tabular-nums opacity-80">{location.unsaved}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onMerge}
        disabled={location.mergeBlockedBy !== null}
        title={location.mergeBlockedBy ?? undefined}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border-float px-2.5 text-xs font-medium text-fg-primary",
          "hover:bg-bg-float-raised",
          "disabled:text-fg-disabled disabled:hover:bg-transparent",
        )}
      >
        {location.unsaved > 0 ? "Save and merge" : "Merge"}
        <ChevronRight size={13} />
      </button>
      <ProposalMenu
        onCompare={onCompare}
        onRename={onRename}
        onCopyLink={onCopyLink}
        onClose={onClose}
        defaultOpen={defaultMenuOpen}
      />
    </div>
  );
}

/** The one line that says what the proposal is doing. */
export function ProposalStatus({
  location,
  onRetrySetup,
}: {
  location: InProposal;
  onRetrySetup: () => void;
}) {
  const { save, proposal, overlay, renderCheck, unsaved } = location;
  const tone = (kind: "quiet" | "busy" | "good" | "bad", text: string) => ({
    kind,
    text,
  });
  const status =
    save.state === "failed"
      ? tone("bad", `Save failed: ${save.error}`)
      : save.state === "saving"
        ? null
        : proposal.setup?.status === "failed"
          ? tone("bad", "Its address could not be set up")
          : proposal.setup?.status === "pending" ||
              proposal.setup?.status === "running"
            ? tone("busy", "Setting up its address…")
            : overlay?.status === "pending" || overlay?.status === "running"
              ? tone("busy", "Updating the preview…")
              : overlay?.status === "failed"
                ? tone("bad", "The preview did not update; trying again")
                : renderCheck?.status === "failed"
                  ? tone("bad", "The front page failed to render")
                  : renderCheck?.status === "pending" ||
                      renderCheck?.status === "running"
                    ? tone("busy", "Checking it renders…")
                    : renderCheck?.status === "succeeded"
                      ? tone("good", "Renders")
                      : null;
  return (
    <div className="hidden min-w-0 items-center gap-2 px-1 text-xs lg:flex">
      {unsaved > 0 && (
        <span className="shrink-0 tabular-nums text-fg-secondary">
          {unsaved} unsaved
        </span>
      )}
      {status !== null && (
        <span
          title={
            status.kind === "bad" && renderCheck?.status === "failed"
              ? (renderCheck.error ?? undefined)
              : undefined
          }
          className={cn(
            "flex min-w-0 items-center gap-1",
            status.kind === "bad"
              ? "text-fg-error-on-surface"
              : status.kind === "good"
                ? "text-fg-secondary"
                : "text-fg-secondary-alt",
          )}
        >
          {status.kind === "busy" && (
            <Loader2 size={12} className="shrink-0 animate-spin" />
          )}
          {status.kind === "bad" && (
            <AlertTriangle size={12} className="shrink-0" />
          )}
          {status.kind === "good" && <Check size={12} className="shrink-0" />}
          <span className="truncate">{status.text}</span>
          {proposal.setup?.status === "failed" && save.state !== "failed" && (
            <button
              type="button"
              onClick={onRetrySetup}
              className="shrink-0 font-medium text-fg-primary underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function ProposalMenu({
  onCompare,
  onRename,
  onCopyLink,
  onClose,
  defaultOpen,
}: {
  onCompare: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  defaultOpen: boolean;
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
          className="absolute right-0 top-full z-full mt-1 w-56 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          <MenuItem icon={<GitCompare size={14} />} onClick={choose(onCompare)}>
            Compare with the site
          </MenuItem>
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
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-float-raised",
        destructive ? "text-fg-error-on-surface" : "text-fg-primary",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center">{icon}</span>
      {children}
    </button>
  );
}
