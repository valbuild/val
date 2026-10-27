import {
  Check,
  ChevronDown,
  CircleArrowUp,
  GitBranch,
  GitCompare,
  Globe,
  Link2,
  List,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import { Spinner } from "../designSystem/spinner";
import type { ProposalSummary, StudioLocation } from "./types";

/**
 * Where you are -- the site, or one proposal -- and the way to go somewhere
 * else. Always in the top bar, so a proposal can be opened without anything
 * prompting for it. `docs/proposals.md`, Flow B, "The switcher".
 *
 * A proposal is a PLACE: choosing one navigates to its address, and in one
 * this reads its name on the proposal colour. Where you are must never be in
 * doubt, and a screenshot should say where it was taken.
 *
 * Lists the OPEN proposals and nothing else; merged and closed ones are in
 * All proposals, which is one click further.
 *
 * In a proposal it is also everything about the proposal itself, as the
 * phone's sheet behind the location chip is (`ProposalSheet`): its name and
 * who made it, then compare, rename, copy its link and close, then where else
 * to go. The Save/Publish menu keeps only what is done with its CHANGES. One
 * layout on both, so nobody learns two.
 */
export function ProposalSwitcher({
  location,
  proposals,
  onOpenSite,
  onOpenProposal,
  onNewProposal,
  onShowAllProposals,
  onRename,
  onCompare,
  onCopyLink,
  onClose,
  loading = false,
  leaving = null,
  defaultOpen = false,
}: {
  location: StudioLocation;
  /** The project's open proposals, newest first. */
  proposals: ProposalSummary[];
  onOpenSite: () => void;
  onOpenProposal: (name: string) => void;
  onNewProposal: () => void;
  onShowAllProposals: () => void;
  /**
   * Rename the proposal you are in. Not offered on the site, nor for an
   * upgrade, which Val Build names after its kind.
   */
  onRename?: () => void;
  /** The proposal against the site. Absent: not offered. */
  onCompare?: () => void;
  /** Copy the proposal's address. */
  onCopyLink?: () => void;
  /** Close it -- discard it, for an upgrade. */
  onClose?: () => void;
  /** See `TopBarProposals.loading`. */
  loading?: boolean;
  /** See `TopBarProposals.leaving`: said here, and nothing more to choose. */
  leaving?: string | null;
  /** For stories: show the menu open. */
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  // Not yet known whether this is the site or a proposal.
  const unknown = loading && location.kind === "site";
  const busy = loading || leaving !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const here = location.kind === "proposal" ? location.proposal.name : null;
  const choose = (action: () => void) => () => {
    setIsOpen(false);
    action();
  };
  return (
    <div ref={containerRef} className="relative h-8 min-w-0 shrink">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-busy={busy || undefined}
        aria-label={
          leaving !== null
            ? leaving
            : unknown
              ? "Finding out where this Studio is"
              : location.kind === "proposal"
                ? `In the proposal ${location.proposal.displayName}. Switch`
                : "On the site. Switch to a proposal"
        }
        disabled={leaving !== null || unknown}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex h-full w-full max-w-full md:max-w-[16rem] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
          "disabled:cursor-progress",
          location.kind === "proposal"
            ? "border-border-proposal bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover"
            : "border-border-float text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        )}
      >
        {busy ? (
          <Spinner size={14} />
        ) : location.kind === "proposal" ? (
          <ProposalIcon
            proposal={location.proposal}
            size={14}
            className="shrink-0"
          />
        ) : (
          <Globe size={14} className="shrink-0" />
        )}
        <span className="truncate">
          {leaving !== null
            ? leaving
            : unknown
              ? "Loading…"
              : location.kind === "proposal"
                ? location.proposal.displayName
                : "The site"}
        </span>
        {leaving === null && !unknown && (
          <ChevronDown size={13} className="shrink-0 opacity-70" />
        )}
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-full mt-1 w-80 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {location.kind === "proposal" ? (
            <>
              {/* The proposal itself, as the phone's sheet heads it. */}
              <div className="mx-1 mb-1 rounded-md bg-bg-proposal-soft px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-fg-proposal">
                  <ProposalIcon proposal={location.proposal} size={12} />
                  {location.proposal.upgrade ? "Upgrade" : "Proposal"}
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-fg-primary">
                  {location.proposal.displayName}
                </div>
                <div className="truncate text-[0.6875rem] text-fg-secondary">
                  {[
                    location.proposal.ownedByViewer
                      ? "You"
                      : (location.proposal.owner?.name ?? null),
                    proposalChangesLabel(location.proposal),
                    location.unsaved > 0 ? `${location.unsaved} unsaved` : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </div>
              </div>
              {onCompare !== undefined && (
                <MenuRow
                  icon={<GitCompare size={14} />}
                  label="Compare with the site"
                  onClick={choose(onCompare)}
                />
              )}
              {/* An upgrade is named by Val Build, after its kind. */}
              {!location.proposal.upgrade && onRename !== undefined && (
                <MenuRow
                  icon={<Pencil size={14} />}
                  label="Rename…"
                  onClick={choose(onRename)}
                />
              )}
              {onCopyLink !== undefined && (
                <MenuRow
                  icon={<Link2 size={14} />}
                  label="Copy link"
                  onClick={choose(onCopyLink)}
                />
              )}
              {onClose !== undefined && (
                <MenuRow
                  icon={<X size={14} />}
                  label={
                    location.proposal.upgrade ? "Discard upgrade…" : "Close…"
                  }
                  destructive
                  onClick={choose(onClose)}
                />
              )}
              <div className="my-1 border-t border-border-float" />
              <SectionLabel>Switch to</SectionLabel>
              <MenuRow
                icon={<Globe size={14} />}
                label="The site"
                detail="What visitors see"
                onClick={choose(onOpenSite)}
              />
              {proposals
                .filter((proposal) => proposal.name !== here)
                .map((proposal) => (
                  <ProposalRow
                    key={proposal.name}
                    proposal={proposal}
                    onClick={choose(() => onOpenProposal(proposal.name))}
                  />
                ))}
            </>
          ) : (
            <>
              <MenuRow
                icon={<Globe size={14} />}
                label="The site"
                detail="What visitors see"
                current
                onClick={choose(onOpenSite)}
              />
              <div className="my-1 border-t border-border-float" />
              <SectionLabel>Proposals</SectionLabel>
              {proposals.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-fg-secondary-alt">
                  None open. A proposal is a copy of the site you can change,
                  save and share before it goes live.
                </div>
              ) : (
                proposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.name}
                    proposal={proposal}
                    onClick={choose(() => onOpenProposal(proposal.name))}
                  />
                ))
              )}
            </>
          )}
          <div className="my-1 border-t border-border-float" />
          <MenuRow
            icon={<Plus size={14} />}
            label="New proposal"
            onClick={choose(onNewProposal)}
          />
          <MenuRow
            icon={<List size={14} />}
            label="All proposals…"
            onClick={choose(onShowAllProposals)}
          />
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
      {children}
    </div>
  );
}

/** An open proposal to go to: who made it, and how much it changes. */
function ProposalRow({
  proposal,
  onClick,
}: {
  proposal: ProposalSummary;
  onClick: () => void;
}) {
  return (
    <MenuRow
      icon={
        <ProposalIcon
          proposal={proposal}
          size={14}
          className="text-fg-proposal"
        />
      }
      label={proposal.displayName}
      detail={`${proposal.ownedByViewer ? "You" : (proposal.owner?.name ?? "Someone")} · ${proposalChangesLabel(proposal)}`}
      onClick={onClick}
    />
  );
}

/**
 * Where you are, on a phone: the switcher reduced to its icon.
 *
 * A proposal's name is whatever its author wrote, and a phone's top bar has no
 * width for it - squeezed in, it crushed the switcher to an icon anyway and
 * pushed the buttons beside it on top of each other. So the chip never names
 * the place. The colour does (the bar wears the proposal's in one), the icon
 * says which kind of place it is, and the chip is the same width in both, so
 * nothing beside it moves when you switch. The name is read in full in the
 * sheet it opens - see `ProposalSheet`.
 */
export function ProposalLocationChip({
  location,
  open,
  onClick,
  busy = false,
}: {
  location: StudioLocation;
  /** Whether its sheet is the one open. */
  open: boolean;
  onClick: () => void;
  /** Loading, or on the way to another address: a spinner for the icon. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={
        location.kind === "proposal"
          ? `In the proposal ${location.proposal.displayName}. Switch`
          : "On the site. Switch to a proposal"
      }
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2",
        location.kind === "proposal"
          ? "border-border-proposal bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover"
          : "border-border-float text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
      )}
    >
      {busy ? (
        <Spinner size={16} />
      ) : location.kind === "proposal" ? (
        <ProposalIcon
          proposal={location.proposal}
          size={15}
          className="shrink-0"
        />
      ) : (
        <Globe size={15} className="shrink-0" />
      )}
      <ChevronDown size={13} className="shrink-0 opacity-70" />
    </button>
  );
}

/**
 * A proposal's icon: a branch, or for an upgrade the upgrade arrow, so an
 * upgrade -- which Val Build made and which holds no content -- is told apart
 * from the proposals people write, wherever proposals are listed.
 */
export function ProposalIcon({
  proposal,
  size,
  className,
}: {
  proposal: Pick<ProposalSummary, "upgrade">;
  size: number;
  className?: string;
}) {
  return proposal.upgrade ? (
    <CircleArrowUp size={size} className={className} />
  ) : (
    <GitBranch size={size} className={className} />
  );
}

export function changesLabel(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

/**
 * What a proposal holds, for a list or a heading: its changes -- or, for an
 * upgrade, that it is one. An upgrade stages dependencies rather than
 * content, so its count of changes is always 0 and says nothing.
 */
export function proposalChangesLabel(
  proposal: Pick<ProposalSummary, "changes" | "upgrade">,
): string {
  return proposal.upgrade ? "Upgrade" : changesLabel(proposal.changes);
}

function MenuRow({
  icon,
  label,
  detail,
  current = false,
  destructive = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  current?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
    >
      <span
        className={cn(
          "grid w-4 shrink-0 place-items-center pt-0.5",
          destructive ? "text-fg-error-on-surface" : "text-fg-secondary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-xs font-medium",
            destructive ? "text-fg-error-on-surface" : "text-fg-primary",
          )}
        >
          {label}
        </span>
        {detail !== undefined && (
          <span className="block truncate text-[0.6875rem] text-fg-secondary-alt">
            {detail}
          </span>
        )}
      </span>
      {current && (
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[0.6875rem] text-fg-secondary-alt">
          <Check size={12} /> here
        </span>
      )}
    </button>
  );
}
