import { GitBranch, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "../designSystem/cn";
import { relativeLocalDate } from "../../utils/relativeLocalDate";
import { changesLabel } from "./ProposalSwitcher";
import { Dialog, DialogContent, DialogTitle } from "../designSystem/dialog";
import type { ProposalSummary } from "./types";

type Tab = ProposalSummary["status"];
const TABS: { tab: Tab; label: string }[] = [
  { tab: "open", label: "Open" },
  { tab: "merged", label: "Merged" },
  { tab: "closed", label: "Closed" },
];

/**
 * All proposals: open, merged and closed. `docs/proposals.md`, Flow B.
 *
 * An open one is opened; a closed one is reopened, which is what makes
 * closing safe. Merged ones are history: what they became is in the site's.
 */
export function ProposalsList({
  proposals,
  loading = false,
  now = new Date(),
  onOpen,
  onReopen,
  onNewProposal,
  reopening = null,
  defaultTab = "open",
}: {
  proposals: ProposalSummary[];
  loading?: boolean;
  /** For stories, so "2h ago" does not drift. */
  now?: Date;
  onOpen: (name: string) => void;
  onReopen: (name: string) => void;
  onNewProposal: () => void;
  /** The proposal being reopened, if one is. */
  reopening?: string | null;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const shown = proposals.filter((proposal) => proposal.status === tab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 pb-2 pl-4 pr-12 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
          <GitBranch size={15} className="text-fg-proposal" />
          Proposals
        </h2>
        <button
          type="button"
          onClick={onNewProposal}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
        >
          <Plus size={14} />
          New proposal
        </button>
      </div>
      <div
        role="tablist"
        className="flex gap-1 border-b border-border-float px-3"
      >
        {TABS.map(({ tab: value, label }) => {
          const count = proposals.filter((p) => p.status === value).length;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px border-b-2 px-2 py-1.5 text-xs font-medium",
                tab === value
                  ? "border-border-proposal text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary",
              )}
            >
              {label}{" "}
              <span className="tabular-nums text-fg-secondary-alt">
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-secondary">
            <Loader2 size={14} className="animate-spin" /> Loading proposals…
          </div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-6 text-xs text-fg-secondary">
            {tab === "open"
              ? "No open proposals. Start one to change the site somewhere nobody else sees until it is merged."
              : tab === "merged"
                ? "Nothing merged yet."
                : "Nothing closed."}
          </div>
        ) : (
          <ul>
            {shown.map((proposal) => (
              <ProposalRow
                key={proposal.name}
                proposal={proposal}
                now={now}
                onOpen={onOpen}
                onReopen={onReopen}
                reopening={reopening === proposal.name}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProposalRow({
  proposal,
  now,
  onOpen,
  onReopen,
  reopening,
}: {
  proposal: ProposalSummary;
  now: Date;
  onOpen: (name: string) => void;
  onReopen: (name: string) => void;
  reopening: boolean;
}) {
  const who = proposal.ownedByViewer
    ? "You"
    : (proposal.owner?.name ?? "Someone");
  return (
    <li className="flex items-start gap-3 border-b border-border-float px-4 py-3">
      <GitBranch size={14} className="mt-0.5 shrink-0 text-fg-proposal" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium text-fg-primary">
            {proposal.displayName}
          </span>
          <span className="shrink-0 text-[0.6875rem] text-fg-secondary-alt">
            {who}
          </span>
        </div>
        {proposal.description && (
          <div className="truncate text-[0.6875rem] text-fg-secondary">
            {proposal.description}
          </div>
        )}
        <div className="mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
          {changesLabel(proposal.changes)} ·{" "}
          {proposal.status === "closed"
            ? `closed${proposal.closedBy ? ` by ${proposal.closedBy.name}` : ""} ${relativeLocalDate(now, proposal.updatedAt)}`
            : proposal.status === "merged"
              ? `merged ${relativeLocalDate(now, proposal.updatedAt)}`
              : `edited ${relativeLocalDate(now, proposal.updatedAt)}`}
        </div>
      </div>
      {proposal.status === "open" && (
        <button
          type="button"
          onClick={() => onOpen(proposal.name)}
          className="h-7 shrink-0 rounded-md border border-border-float px-2.5 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
        >
          Open
        </button>
      )}
      {proposal.status === "closed" && (
        <button
          type="button"
          onClick={() => onReopen(proposal.name)}
          disabled={reopening}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-float px-2.5 text-xs font-medium text-fg-primary hover:bg-bg-float-raised disabled:opacity-60"
        >
          {reopening && <Loader2 size={12} className="animate-spin" />}
          Reopen
        </button>
      )}
    </li>
  );
}

/**
 * All proposals, as a dialog over the Studio: reached from the switcher, and
 * gone again once one is opened.
 */
export function AllProposalsDialog({
  open,
  onOpenChange,
  portalContainer,
  ...list
}: React.ComponentProps<typeof ProposalsList> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="h-[min(36rem,80vh)] max-w-xl gap-0 border-border-float bg-bg-float p-0"
      >
        <DialogTitle className="sr-only">All proposals</DialogTitle>
        <ProposalsList {...list} />
      </DialogContent>
    </Dialog>
  );
}
