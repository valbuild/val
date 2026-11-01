import { CodeXml, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import { ProposalIcon, proposalChangesLabel } from "./ProposalSwitcher";
import type { ProposalSummary, StudioLocation } from "./types";

/**
 * Code mode, in the top bar: the `</>` right of the proposal switcher.
 *
 * In code mode the assistant may change the proposal's code, and the
 * workspace shows the proposal's build instead of the content editor. The
 * assistant always HAS the code tools in a hosted Studio; with code mode off
 * they refuse, and the assistant asks for it to be turned on instead (see
 * `CodeModeRequestCard`).
 *
 * Code is only ever changed in a proposal, so where you are decides what the
 * button does:
 *
 * - **On the site** it opens a menu of the open proposals. Choosing one goes
 *   to its address with code mode on (a query parameter), the same way the
 *   switcher goes to one.
 * - **In a proposal** it is a toggle, pressed while code mode is on.
 *
 * Absent (`TopBarProposals.codeMode` unset) outside a hosted Studio: local
 * development changes code in an editor, not here.
 */
export type TopBarCodeMode = {
  /** Whether code mode is on. Only ever true in a proposal. */
  on: boolean;
  /** In a proposal: turn code mode on, or off. */
  onToggle: () => void;
  /** On the site: go to this proposal, with code mode on. */
  onOpenProposalInCodeMode: (name: string) => void;
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
  const requests = codeMode.openMenuRequests ?? 0;
  useEffect(() => {
    if (requests > 0) setIsOpen(true);
  }, [requests]);
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
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? "Code mode is on. Turn it off" : "Turn on code mode"}
        title={
          on
            ? "Code mode is on: the assistant can change this proposal's code, and you see it in the preview. Press to go back to editing content."
            : "Code mode: let the assistant change this proposal's code, and see it in the preview."
        }
        disabled={disabled}
        onClick={codeMode.onToggle}
        className={cn(
          // An icon alone, in both states: pressed reads as on.
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
          "disabled:cursor-progress disabled:opacity-60",
          on
            ? "border-border-proposal bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover"
            : "border-border-proposal text-fg-proposal hover:bg-bg-proposal-soft",
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
