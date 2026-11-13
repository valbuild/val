import { CodeXml, Plus, Power } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import { ProposalIcon, proposalChangesLabel } from "./ProposalSwitcher";
import type { ProposalSummary, StudioLocation } from "./types";

/**
 * Code mode, in the top bar: the `</>` right of the proposal switcher.
 *
 * In code mode the assistant may change the proposal's code, and the column
 * beside the preview shows the code changes instead of the content editor
 * (the preview is the Studio's canvas in every mode). The
 * assistant always HAS the code tools in a hosted Studio; with code mode off
 * they refuse, and the assistant asks for it to be turned on instead (see
 * `CodeModeRequestCard`).
 *
 * Code is only ever changed in a proposal, so where you are decides what the
 * button does:
 *
 * - **On the site, where the project lets it** (`onOpenSiteCode`) it turns
 *   on the site's own code mode: everything waiting to be published moves
 *   into the project's site-code proposal, which opens with code mode on and
 *   is shown as the site (valbuild/home `docs/proposals.md`, "Code mode on
 *   the site").
 * - **On the site, where it does not,** it opens a menu of the open
 *   proposals. Choosing one goes to its address with code mode on (a query
 *   parameter), the same way the switcher goes to one.
 * - **In a proposal** it is pressed while code mode is on. Code mode is the
 *   PROPOSAL's, kept by the backend and the same for everyone in it; what
 *   each person looks at is their own (`view`). Off, pressing it turns code
 *   mode on, which saves every pending change first. On, it opens a menu:
 *   who turned it on, which view to see, and Turn off -- which discards
 *   nothing.
 *
 * Absent (`TopBarProposals.codeMode` unset) outside a hosted Studio: local
 * development changes code in an editor, not here.
 */
export type TopBarCodeMode = {
  /** Whether code mode is on. Only ever true in a proposal. */
  on: boolean;
  /**
   * In a proposal: turn code mode on, or off -- for everyone in it. Turning
   * it on saves the pending changes first.
   */
  onToggle: () => void;
  /** Turning it on or off now. */
  busy?: boolean;
  /**
   * Who turned it on, and when: "Code mode on: turned on by Kari, 10 minutes
   * ago". `null` while that is not known.
   */
  turnedOn?: CodeModeTurnedOn | null;
  /**
   * Show the proposal's code changes: in Review, beside the content
   * changes.
   */
  onShowCode?: () => void;
  /** On the site: go to this proposal, with code mode on. */
  onOpenProposalInCodeMode: (name: string) => void;
  /**
   * On the site, where the project lets `</>` change the site's code
   * (valbuild/home `docs/proposals.md`, "Code mode on the site"): open it.
   * Absent where it does not, and the button lists proposals instead.
   */
  onOpenSiteCode?: () => void;
  /** On the site: make a new proposal, and open it with code mode on. */
  onNewProposalInCodeMode: () => void;
  /**
   * On the site: opens the menu each time it changes, from somewhere other
   * than the button -- the assistant's "Choose a proposal…" (see
   * `CodeModeRequestCard`). A count rather than a flag, so asking twice opens
   * it twice.
   */
  openMenuRequests?: number;
  /** For stories: the site's menu, open. */
  defaultMenuOpen?: boolean;
};

/** Who turned code mode on, and how long ago, in words. */
export type CodeModeTurnedOn = {
  /** "Kari Nordmann", or "you". */
  by: string;
  /** "10 minutes ago". */
  ago: string;
};

/** "Code mode on: turned on by Kari Nordmann, 10 minutes ago". */
export function codeModeOnLine(turnedOn: CodeModeTurnedOn | null): string {
  return turnedOn === null
    ? "Code mode on"
    : `Code mode on: turned on by ${turnedOn.by}, ${turnedOn.ago}`;
}

/** "Turned on by Kari Nordmann, 10 minutes ago", or `null` when not known. */
export function codeModeTurnedOnText(
  turnedOn: CodeModeTurnedOn | null,
): string | null {
  return turnedOn === null
    ? null
    : `Turned on by ${turnedOn.by}, ${turnedOn.ago}`;
}

export function CodeModeButton({
  location,
  proposals,
  codeMode,
  disabled = false,
}: {
  location: StudioLocation;
  /** The open proposals, newest first: the site's menu lists them. */
  proposals: ProposalSummary[];
  codeMode: TopBarCodeMode;
  /** Loading, or on the way to another address. */
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(codeMode.defaultMenuOpen ?? false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  /*
   * Opens on a NEW request only, and only on the site, where there is a
   * menu: the count seen at mount is not a request, nor is one that arrived
   * in a proposal, so a remount or a return to the site never opens it.
   */
  const requests = codeMode.openMenuRequests ?? 0;
  const seenRequests = useRef(requests);
  const onSite = location.kind === "site";
  useEffect(() => {
    if (requests === seenRequests.current) return;
    seenRequests.current = requests;
    if (onSite) setIsOpen(true);
  }, [requests, onSite]);
  // Leaving the site closes the site's menu; the proposal's opens itself.
  const wasOnSite = useRef(onSite);
  useEffect(() => {
    if (wasOnSite.current && !onSite) setIsOpen(false);
    wasOnSite.current = onSite;
  }, [onSite]);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (location.kind === "proposal") {
    /*
     * Not offered where there is no code to change here: an upgrade's code is
     * Val Build's, and a published proposal is finished.
     */
    if (
      location.proposal.upgrade === true ||
      location.proposal.status !== "open"
    ) {
      return null;
    }
    const on = codeMode.on;
    const busy = codeMode.busy === true;
    if (!on) {
      return (
        <button
          type="button"
          aria-pressed={false}
          aria-label="Turn on code mode"
          title="Code mode: let the assistant change this proposal's code, and see it in the preview. Everything pending is saved first."
          disabled={disabled || busy}
          onClick={codeMode.onToggle}
          className={cn(
            // An icon alone, in both states: pressed reads as on.
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
            "disabled:cursor-progress disabled:opacity-60",
            "border-border-proposal text-fg-proposal hover:bg-bg-proposal-soft",
          )}
        >
          <CodeXml size={15} className="shrink-0" />
        </button>
      );
    }
    return (
      <div ref={containerRef} className="relative h-8 shrink-0">
        <button
          type="button"
          aria-pressed
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Code mode is on"
          title={codeModeOnLine(codeMode.turnedOn ?? null)}
          disabled={disabled || busy}
          onClick={() => setIsOpen((open) => !open)}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
            "disabled:cursor-progress disabled:opacity-60",
            "border-border-proposal bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
          )}
        >
          <CodeXml size={15} className="shrink-0" />
        </button>
        {isOpen && (
          <div
            role="menu"
            aria-label="Code mode"
            className="absolute left-0 top-full z-full mt-1 w-72 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
          >
            <div className="px-3 pb-2 pt-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-fg-primary">
                <CodeXml size={14} className="shrink-0 text-fg-proposal" />
                {codeModeOnLine(codeMode.turnedOn ?? null)}
              </div>
              <p className="mt-1 text-[0.6875rem] leading-snug text-fg-secondary">
                For everyone in this proposal: the assistant can change its
                code, and every change is saved before the code changes.
              </p>
            </div>
            <div className="my-1 border-t border-border-float" />
            {codeMode.onShowCode !== undefined && (
              <>
                <MenuItem
                  icon={<CodeXml size={14} />}
                  label="Code changes"
                  detail="In Review, beside the content changes"
                  onClick={() => {
                    setIsOpen(false);
                    codeMode.onShowCode?.();
                  }}
                />
                <div className="my-1 border-t border-border-float" />
              </>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                codeMode.onToggle();
              }}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
            >
              <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-fg-secondary">
                <Power size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-fg-primary">
                  Turn off code mode
                </span>
                <span className="block text-[0.6875rem] leading-snug text-fg-secondary-alt">
                  For everyone. Nothing is discarded: the code stays in the
                  proposal, and the assistant can no longer change it.
                </span>
              </span>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (codeMode.onOpenSiteCode !== undefined) {
    return (
      <button
        type="button"
        aria-pressed={false}
        aria-label="Turn on code mode"
        title="Code mode: let the assistant change the site's code, and see it in the preview. Everything waiting to be published goes with it, and the site changes when you publish."
        disabled={disabled}
        onClick={codeMode.onOpenSiteCode}
        className={cn(
          "inline-flex h-full items-center rounded-md border border-border-float px-2 text-fg-secondary",
          "hover:bg-bg-float-raised hover:text-fg-primary",
          "disabled:cursor-progress disabled:opacity-60",
        )}
      >
        <CodeXml size={15} className="shrink-0" />
      </button>
    );
  }
  const candidates = proposals.filter(
    (proposal) => proposal.status === "open" && proposal.upgrade !== true,
  );
  const choose = (act: () => void) => () => {
    setIsOpen(false);
    act();
  };
  return (
    <div ref={containerRef} className="relative h-8 shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Code mode: choose a proposal to change the code in"
        title="Code mode: the site's code is changed in a proposal. Choose one."
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex h-full items-center rounded-md border border-border-float px-2 text-fg-secondary",
          "hover:bg-bg-float-raised hover:text-fg-primary",
          "disabled:cursor-progress disabled:opacity-60",
          isOpen && "bg-bg-float-raised text-fg-primary",
        )}
      >
        <CodeXml size={15} className="shrink-0" />
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Open a proposal in code mode"
          className="absolute left-0 top-full z-full mt-1 w-80 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg-primary">
              <CodeXml size={14} className="shrink-0 text-fg-proposal" />
              Code mode
            </div>
            <p className="mt-1 text-[0.6875rem] leading-snug text-fg-secondary">
              The site&rsquo;s code is never changed directly. Choose a
              proposal: it opens with code mode on, and the assistant can change
              its code. The site changes when the proposal is published.
            </p>
          </div>
          <div className="my-1 border-t border-border-float" />
          <div className="px-3 pb-1 pt-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
            Open in code mode
          </div>
          {candidates.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-fg-secondary-alt">
              No proposals open. Start one to change the code in.
            </div>
          ) : (
            candidates.map((proposal) => (
              <button
                key={proposal.name}
                type="button"
                role="menuitem"
                onClick={choose(() =>
                  codeMode.onOpenProposalInCodeMode(proposal.name),
                )}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
              >
                <span className="grid w-4 shrink-0 place-items-center pt-0.5">
                  <ProposalIcon
                    proposal={proposal}
                    size={14}
                    className="text-fg-proposal"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-fg-primary">
                    {proposal.displayName}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-fg-secondary-alt">
                    {`${proposal.ownedByViewer ? "You" : (proposal.owner?.name ?? "Someone")} · ${proposalChangesLabel(proposal)}`}
                  </span>
                </span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-border-float" />
          <button
            type="button"
            role="menuitem"
            onClick={choose(codeMode.onNewProposalInCodeMode)}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
          >
            <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-fg-secondary">
              <Plus size={14} />
            </span>
            <span className="min-w-0 flex-1 text-xs font-medium text-fg-primary">
              New proposal in code mode…
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-bg-float-raised"
    >
      <span className="grid w-4 shrink-0 place-items-center pt-0.5 text-fg-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-fg-primary">
          {label}
        </span>
        <span className="block text-[0.6875rem] leading-snug text-fg-secondary-alt">
          {detail}
        </span>
      </span>
    </button>
  );
}
