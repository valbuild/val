import {
  GitBranch,
  GitCompare,
  Globe,
  Link2,
  List,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { FloatingPanel, PanelSectionLabel } from "../shell/FloatingPanel";
import { SheetHeading, SheetRow } from "../shell/PhoneSheet";
import type { TopBarProposals } from "../shell/TopBar";
import type { ShellBreakpoint } from "../shell/types";
import { proposalChangesLabel } from "./ProposalSwitcher";
import type { ProposalSummary } from "./types";

/**
 * Where you are, on a phone: the sheet behind the top bar's location chip.
 *
 * The phone's top bar does not name the proposal you are in -- a name is
 * whatever its author wrote, and there is no width for it there. It shows the
 * place with colour and an icon instead, and this sheet is where the name is
 * read IN FULL, wrapping rather than truncated. Above a phone the switcher in
 * the top bar names it, and `ProposalMenu` beside it carries the same actions.
 *
 * One sheet for everything about the proposal: its name, what you can do to it,
 * and the way out to somewhere else. Publish is not here: it is something you
 * do with the CHANGES, so it is under the primary button's caret with Save,
 * Review and Build -- see `ChangesSheet`.
 */
export function ProposalSheet({
  breakpoint,
  proposals,
  onClose,
}: {
  breakpoint: ShellBreakpoint;
  proposals: TopBarProposals;
  onClose: () => void;
}) {
  const { location } = proposals;
  const here = location.kind === "proposal" ? location : null;
  const choose = (action: () => void) => () => {
    onClose();
    action();
  };
  const elsewhere = proposals.open.filter(
    (proposal) => proposal.name !== here?.proposal.name,
  );
  return (
    <FloatingPanel
      side="left"
      width={320}
      title={here !== null ? here.proposal.displayName : "The site"}
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      tone={here !== null ? "proposal" : undefined}
      heading={
        here !== null ? (
          <SheetHeading
            kicker={
              <>
                <GitBranch size={12} /> Proposal
              </>
            }
            proposal
            title={here.proposal.displayName}
            detail={[
              ownerLabel(here.proposal),
              proposalChangesLabel(here.proposal),
              here.unsaved > 0 ? `${here.unsaved} unsaved` : null,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          />
        ) : (
          <SheetHeading
            kicker={
              <>
                <Globe size={12} /> You are on
              </>
            }
            title="The site"
            detail="What visitors see"
          />
        )
      }
    >
      <div className="pb-4">
        {here !== null && (
          <div className="py-1">
            {proposals.onCompare !== undefined && (
              <SheetRow
                icon={<GitCompare size={16} />}
                onClick={choose(proposals.onCompare)}
              >
                Compare with the site
              </SheetRow>
            )}
            <SheetRow
              icon={<Pencil size={16} />}
              onClick={choose(proposals.onRename)}
            >
              Rename…
            </SheetRow>
            <SheetRow
              icon={<Link2 size={16} />}
              onClick={choose(proposals.onCopyLink)}
            >
              Copy link
            </SheetRow>
            <SheetRow
              icon={<X size={16} />}
              onClick={choose(proposals.onClose)}
              destructive
            >
              Close…
            </SheetRow>
          </div>
        )}
        <PanelSectionLabel divided={here !== null}>Switch to</PanelSectionLabel>
        {here !== null && (
          <SheetRow
            icon={<Globe size={16} />}
            detail="What visitors see"
            onClick={choose(proposals.onOpenSite)}
          >
            The site
          </SheetRow>
        )}
        {here === null && elsewhere.length === 0 && (
          <p className="px-4 py-2 text-xs text-fg-secondary-alt">
            No proposals open. A proposal is a copy of the site you can change,
            save and share before it goes live.
          </p>
        )}
        {elsewhere.map((proposal) => (
          <SheetRow
            key={proposal.name}
            icon={<GitBranch size={16} className="text-fg-proposal" />}
            detail={`${ownerLabel(proposal)} · ${proposalChangesLabel(proposal)}`}
            onClick={choose(() => proposals.onOpenProposal(proposal.name))}
          >
            {proposal.displayName}
          </SheetRow>
        ))}
        <SheetRow
          icon={<Plus size={16} />}
          onClick={choose(proposals.onNewProposal)}
        >
          New proposal
        </SheetRow>
        <SheetRow
          icon={<List size={16} />}
          onClick={choose(proposals.onShowAllProposals)}
        >
          All proposals…
        </SheetRow>
      </div>
    </FloatingPanel>
  );
}

function ownerLabel(proposal: ProposalSummary): string {
  return proposal.ownedByViewer ? "You" : (proposal.owner?.name ?? "Someone");
}
