import {
  CodeXml,
  GitBranch,
  GitCompare,
  Globe,
  Link2,
  List,
  Paintbrush,
  Pencil,
  PencilLine,
  Plus,
  X,
} from "lucide-react";
import { useState } from "react";
import { FloatingPanel, PanelSectionLabel } from "../shell/FloatingPanel";
import { SheetHeading, SheetRow } from "../shell/PhoneSheet";
import type { TopBarProposals } from "../shell/TopBar";
import type { ShellBreakpoint } from "../shell/types";
import { ProposalIcon, proposalChangesLabel } from "./ProposalSwitcher";
import type { ProposalSummary } from "./types";
import { PreviewProblemCard } from "./PreviewProblemCard";
import { codeModeTurnedOnText } from "./CodeModeButton";

/**
 * Where you are, on a phone: the sheet behind the top bar's location chip.
 *
 * The phone's top bar does not name the proposal you are in -- a name is
 * whatever its author wrote, and there is no width for it there. It shows the
 * place with colour and an icon instead, and this sheet is where the name is
 * read IN FULL, wrapping rather than truncated. Above a phone the switcher in
 * the top bar names it, and `ProposalActionButton`'s menu carries the same actions.
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
  const problem = proposals.previewProblem ?? null;
  const here = location.kind === "proposal" ? location : null;
  const choose = (action: () => void) => () => {
    onClose();
    action();
  };
  const elsewhere = proposals.open.filter(
    (proposal) => proposal.name !== here?.proposal.name,
  );
  /*
   * Code mode, as the `</>` beside the switcher has it above a phone
   * (`CodeModeButton`): a switch in a proposal, and on the site a list of the
   * proposals to open in code mode, folded until asked for.
   */
  const codeMode = proposals.codeMode;
  const [choosingForCode, setChoosingForCode] = useState(false);
  const codeCandidates = proposals.open.filter(
    (proposal) => proposal.status === "open" && proposal.upgrade !== true,
  );
  const codeSwitchable =
    here !== null &&
    here.proposal.status === "open" &&
    here.proposal.upgrade !== true;
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
        {here !== null && problem !== null && (
          <div className="px-3 pt-3">
            <PreviewProblemCard problem={problem} onAct={onClose} />
          </div>
        )}
        {codeMode !== undefined && codeSwitchable && (
          <div className="py-1">
            <SheetRow
              icon={<CodeXml size={16} className="text-fg-proposal" />}
              detail={
                codeMode.on
                  ? `${codeModeTurnedOnText(codeMode.turnedOn ?? null) ?? "On"}. For everyone in this proposal; turning it off discards nothing.`
                  : "Let the assistant change the code. Everything pending is saved first."
              }
              trailing={<SheetSwitch on={codeMode.on} />}
              onClick={choose(codeMode.onToggle)}
            >
              Code mode
            </SheetRow>
            {/* Each person's own: what they see while it is on. */}
            {codeMode.on && codeMode.onViewChange !== undefined && (
              <SheetRow
                icon={
                  (codeMode.view ?? "code") === "code" ? (
                    <PencilLine size={16} />
                  ) : (
                    <CodeXml size={16} />
                  )
                }
                detail={
                  (codeMode.view ?? "code") === "code"
                    ? "Edit content while the code changes"
                    : "The proposal as its code is now"
                }
                onClick={choose(() =>
                  codeMode.onViewChange?.(
                    (codeMode.view ?? "code") === "code" ? "content" : "code",
                  ),
                )}
              >
                {(codeMode.view ?? "code") === "code"
                  ? "Show the content editor"
                  : "Show the preview and code"}
              </SheetRow>
            )}
          </div>
        )}
        {here !== null && (
          <div
            className={
              codeMode !== undefined && codeSwitchable
                ? "border-t border-border-float py-1"
                : "py-1"
            }
          >
            {proposals.onCompare !== undefined && (
              <SheetRow
                icon={<GitCompare size={16} />}
                onClick={choose(proposals.onCompare)}
              >
                Compare with the site
              </SheetRow>
            )}
            {/* The switcher's menu has it above a phone: the same act. */}
            {proposals.onOpenDesign !== undefined && (
              <SheetRow
                icon={<Paintbrush size={16} />}
                detail="Change its code with the assistant"
                onClick={choose(proposals.onOpenDesign)}
              >
                Open design tab
              </SheetRow>
            )}
            {/* An upgrade is named after its kind, by Val Build. */}
            {!here.proposal.upgrade && (
              <SheetRow
                icon={<Pencil size={16} />}
                onClick={choose(proposals.onRename)}
              >
                Rename…
              </SheetRow>
            )}
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
              {here.proposal.upgrade ? "Discard upgrade…" : "Close…"}
            </SheetRow>
          </div>
        )}
        {codeMode !== undefined && here === null && (
          <div className="py-1">
            <SheetRow
              icon={<CodeXml size={16} />}
              detail="Choose a proposal to change the code in"
              trailing={choosingForCode ? "Hide" : undefined}
              onClick={() => setChoosingForCode((open) => !open)}
            >
              Code mode…
            </SheetRow>
            {choosingForCode && (
              <div className="pl-8">
                {codeCandidates.length === 0 && (
                  <p className="px-4 py-2 text-xs text-fg-secondary-alt">
                    No proposals open. Start one to change the code in.
                  </p>
                )}
                {codeCandidates.map((proposal) => (
                  <SheetRow
                    key={proposal.name}
                    icon={
                      <ProposalIcon
                        proposal={proposal}
                        size={16}
                        className="text-fg-proposal"
                      />
                    }
                    detail={`${ownerLabel(proposal)} · ${proposalChangesLabel(proposal)}`}
                    onClick={choose(() =>
                      codeMode.onOpenProposalInCodeMode(proposal.name),
                    )}
                  >
                    {proposal.displayName}
                  </SheetRow>
                ))}
                <SheetRow
                  icon={<Plus size={16} />}
                  onClick={choose(codeMode.onNewProposalInCodeMode)}
                >
                  New proposal in code mode…
                </SheetRow>
              </div>
            )}
          </div>
        )}
        <PanelSectionLabel divided={here !== null || codeMode !== undefined}>
          Switch to
        </PanelSectionLabel>
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
            icon={
              <ProposalIcon
                proposal={proposal}
                size={16}
                className="text-fg-proposal"
              />
            }
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

/** On or off, at the end of a sheet row: the whole row is what is pressed. */
function SheetSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "flex h-5 w-9 items-center justify-end rounded-full bg-bg-proposal p-0.5"
          : "flex h-5 w-9 items-center justify-start rounded-full bg-bg-float-raised p-0.5 ring-1 ring-inset ring-border-float"
      }
    >
      <span aria-hidden className="h-4 w-4 rounded-full bg-white shadow-sm" />
      {/* What a screen reader says: the drawn switch says nothing. */}
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </span>
  );
}
