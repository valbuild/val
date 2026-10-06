import { Check, ChevronDown, GitBranch, Globe, List, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
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
 */
export function ProposalSwitcher({
  location,
  proposals,
  onOpenSite,
  onOpenProposal,
  onNewProposal,
  onShowAllProposals,
  defaultOpen = false,
}: {
  location: StudioLocation;
  /** The project's open proposals, newest first. */
  proposals: ProposalSummary[];
  onOpenSite: () => void;
  onOpenProposal: (name: string) => void;
  onNewProposal: () => void;
  onShowAllProposals: () => void;
  /** For stories: show the menu open. */
  defaultOpen?: boolean;
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

  const here = location.kind === "proposal" ? location.proposal.name : null;
  const choose = (action: () => void) => () => {
    setIsOpen(false);
    action();
  };
  return (
    <div ref={containerRef} className="relative h-8 min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={
          location.kind === "proposal"
            ? `In the proposal ${location.proposal.displayName}. Switch`
            : "On the site. Switch to a proposal"
        }
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex h-full max-w-[16rem] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
          location.kind === "proposal"
            ? "border-border-proposal bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover"
            : "border-border-float text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        )}
      >
        {location.kind === "proposal" ? (
          <GitBranch size={14} className="shrink-0" />
        ) : (
          <Globe size={14} className="shrink-0" />
        )}
        <span className="truncate">
          {location.kind === "proposal"
            ? location.proposal.displayName
            : "The site"}
        </span>
        <ChevronDown size={13} className="shrink-0 opacity-70" />
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-full mt-1 w-72 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          <MenuRow
            icon={<Globe size={14} />}
            label="The site"
            detail="What visitors see"
            current={here === null}
            onClick={choose(onOpenSite)}
          />
          <div className="my-1 border-t border-border-float" />
          <div className="px-3 pb-1 pt-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
            Proposals
          </div>
          {proposals.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-fg-secondary-alt">
              None open. A proposal is a copy of the site you can change, save
              and share before it goes live.
            </div>
          ) : (
            proposals.map((proposal) => (
              <MenuRow
                key={proposal.name}
                icon={<GitBranch size={14} className="text-fg-proposal" />}
                label={proposal.displayName}
                detail={`${proposal.ownedByViewer ? "You" : (proposal.owner?.name ?? "Someone")} · ${changesLabel(proposal.changes)}`}
                current={here === proposal.name}
                onClick={choose(() => onOpenProposal(proposal.name))}
              />
            ))
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

export function changesLabel(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

function MenuRow({
  icon,
  label,
  detail,
  current = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  current?: boolean;
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
      <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-fg-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg-primary">
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
