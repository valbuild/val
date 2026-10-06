import {
  AlertTriangle,
  Check,
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
 * What the top bar does in a proposal, in pieces the bar lays out.
 * `docs/proposals.md`, Flow B, "Inside a proposal".
 *
 * Save, Publish and a menu. Save commits the proposal's changes and its
 * address serves them on the next request; it is never a publish and never a
 * push. Publish is the proposal's way to the site -- merging it -- and saves
 * first when there is something unsaved, because only what was saved is ever
 * published. It is shown and disabled with its reason until merging exists.
 *
 * The status beside Save says what the proposal is doing, most urgent first:
 * a save that failed, the address being made or brought up to date, and then
 * whether it rendered after the last save. A render that failed is a report,
 * never a gate: it blocks nothing.
 */
export function ProposalSaveButton({
  location,
  onSave,
  className,
}: {
  location: InProposal;
  onSave: () => void;
  className?: string;
}) {
  const saving = location.save.state === "saving";
  const canSave = location.unsaved > 0 && !saving;
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={!canSave}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      {saving ? (
        <Loader2 size={14} className="shrink-0 animate-spin" />
      ) : (
        <Save size={14} className="shrink-0" />
      )}
      <span className="truncate">{saving ? "Saving…" : "Save"}</span>
      {!saving && location.unsaved > 0 && (
        <span className="tabular-nums opacity-80">{location.unsaved}</span>
      )}
    </button>
  );
}

/**
 * Publish, in a proposal: merging it into the site. Looks like the site's
 * Publish because it is the same act from the editor's side -- what is here
 * goes live -- and is told apart by where it sits and what it is next to.
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
        "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover",
        "disabled:border-border-float disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      <Upload size={14} className="shrink-0" />
      <span className="truncate">Publish</span>
    </button>
  );
}

/**
 * The three pieces in a row: the status, Save, Publish and the menu. The
 * layout the bar used first, kept for comparing the others against.
 */
export function ProposalBar({
  location,
  onSave,
  onPublish,
  onRetrySetup,
  menu,
}: {
  location: InProposal;
  onSave: () => void;
  onPublish: () => void;
  onRetrySetup: () => void;
  menu: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ProposalStatus location={location} onRetrySetup={onRetrySetup} />
      <ProposalSaveButton location={location} onSave={onSave} />
      <ProposalPublishButton location={location} onPublish={onPublish} />
      {menu}
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

/**
 * The proposal's own menu: compare, rename, copy its link, close. On a phone,
 * where the bottom bar has room for one action, it also carries Publish.
 */
export function ProposalMenu({
  onCompare,
  onRename,
  onCopyLink,
  onClose,
  onPublish,
  publishBlockedBy = null,
  defaultOpen = false,
  menuPlacement = "below",
}: {
  onCompare: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  /** Offer Publish here too: the phone layout. */
  onPublish?: () => void;
  publishBlockedBy?: string | null;
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
          {onPublish !== undefined && (
            <>
              <MenuItem
                icon={<Upload size={14} />}
                onClick={choose(onPublish)}
                disabled={publishBlockedBy !== null}
                detail={publishBlockedBy ?? undefined}
              >
                Publish to the site
              </MenuItem>
              <div className="my-1 border-t border-border-float" />
            </>
          )}
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
