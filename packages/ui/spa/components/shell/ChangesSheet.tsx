import {
  AlertTriangle,
  GitBranch,
  GitCompare,
  Globe,
  Hammer,
  Package,
  Save,
  Upload,
} from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { SheetHeading, SheetRow } from "./PhoneSheet";
import type { TopBarProposals } from "./TopBar";
import { DiscardAllQuickAction, reviewChangesLabel } from "./UtilityPanel";
import { ShellBreakpoint } from "./types";
import {
  describeDependencies,
  isDependenciesState,
} from "../proposals/ProposalBar";

/**
 * What you can do with the changes, on a phone: the sheet behind the caret
 * beside the bottom bar's primary button.
 *
 * The bottom bar has room for ONE action, and which one depends on where you
 * are and what state the work is in (see `MobilePrimaryAction`). Everything
 * else you can do with the same changes is here, so pressing the caret always
 * finds the rest: Review and Discard everywhere, and in a proposal Save, Build
 * and Publish too -- publishing a proposal is merging its changes, so it
 * belongs with them rather than with the proposal's own name and settings in
 * `ProposalSheet`.
 */
export function ChangesSheet({
  breakpoint,
  proposals,
  onCompare,
  reviewCount,
  pendingChanges,
  onDiscardAll,
  discardAllDescription,
  portalContainer,
  onClose,
}: {
  breakpoint: ShellBreakpoint;
  proposals?: TopBarProposals;
  onCompare?: () => void;
  reviewCount?: number;
  pendingChanges: number;
  onDiscardAll?: () => void;
  discardAllDescription?: string;
  portalContainer?: HTMLElement | null;
  onClose: () => void;
}) {
  const here =
    proposals?.location.kind === "proposal" ? proposals.location : null;
  const choose = (action: () => void) => () => {
    onClose();
    action();
  };
  const blocked =
    here !== null &&
    here.unsaved > 0 &&
    proposals?.saveBlockedBy !== undefined &&
    proposals.saveBlockedBy.errors > 0
      ? proposals.saveBlockedBy
      : null;
  return (
    <FloatingPanel
      side="right"
      width={320}
      title="Changes"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      tone={here !== null ? "proposal" : undefined}
      heading={
        here !== null ? (
          <SheetHeading
            proposal
            kicker={
              <>
                <GitBranch size={12} /> Proposal
              </>
            }
            title="Changes"
            detail={`${here.unsaved} unsaved · ${here.proposal.changes} saved`}
          />
        ) : (
          <SheetHeading
            kicker={
              <>
                <Globe size={12} /> The site
              </>
            }
            title="Changes"
            detail={
              pendingChanges > 0
                ? `${pendingChanges} not published`
                : "Nothing waiting to be published"
            }
          />
        )
      }
    >
      <div className="py-1 pb-4">
        {proposals !== undefined && here !== null && here.unsaved > 0 && (
          <>
            {blocked !== null ? (
              <SheetRow
                icon={
                  <AlertTriangle
                    size={16}
                    className="text-fg-error-on-surface"
                  />
                }
                detail="They have to be fixed before the proposal can be saved"
                onClick={choose(blocked.onShow)}
              >
                {`Fix ${blocked.errors} validation ${blocked.errors === 1 ? "error" : "errors"}`}
              </SheetRow>
            ) : (
              <SheetRow
                icon={<Save size={16} />}
                trailing={here.unsaved}
                disabled={here.save.state === "saving"}
                detail={
                  here.save.state === "failed"
                    ? `${here.save.error}. Press to try again.`
                    : undefined
                }
                onClick={choose(proposals.onSave)}
              >
                {here.save.state === "saving" ? "Saving…" : "Save"}
              </SheetRow>
            )}
          </>
        )}
        {onCompare !== undefined && (
          <SheetRow
            icon={<GitCompare size={16} />}
            detail="Side by side with what they replace"
            onClick={choose(onCompare)}
          >
            {reviewChangesLabel(pendingChanges, reviewCount)}
          </SheetRow>
        )}
        {proposals?.onBuild !== undefined &&
          here !== null &&
          here.code !== null &&
          isDependenciesState(here.code) && (
            <SheetRow
              icon={<Package size={16} />}
              disabled={
                describeDependencies(here.code).busy ||
                describeDependencies(here.code).failed
              }
              detail={describeDependencies(here.code).detail}
              onClick={choose(proposals.onBuild)}
            >
              {describeDependencies(here.code).label}
            </SheetRow>
          )}
        {proposals?.onBuild !== undefined &&
          here !== null &&
          here.code !== null &&
          !isDependenciesState(here.code) && (
            <SheetRow
              icon={<Hammer size={16} />}
              disabled={here.code.state === "building"}
              detail={
                here.code.state === "failed"
                  ? `The build failed: ${here.code.error}. Press to build again.`
                  : here.code.state === "blocked"
                    ? "This browser builds the proposal in a new tab, and did not let it open. Press to open it."
                    : "Code changed in this proposal. Build it so the preview shows it."
              }
              onClick={choose(proposals.onBuild)}
            >
              {here.code.state === "building"
                ? "Building…"
                : here.code.state === "blocked"
                  ? "Open the tab to build"
                  : "Build"}
            </SheetRow>
          )}
        {proposals !== undefined && here !== null && (
          <SheetRow
            icon={<Upload size={16} />}
            disabled={here.publishBlockedBy !== null}
            detail={
              here.publishBlockedBy ??
              (here.unsaved > 0
                ? "Saves the proposal, then publishes it"
                : "Merges the proposal into the site")
            }
            onClick={choose(proposals.onPublish)}
          >
            Publish to the site
          </SheetRow>
        )}
        {onDiscardAll !== undefined && pendingChanges > 0 && (
          <DiscardAllQuickAction
            variant="sheet"
            count={pendingChanges}
            description={discardAllDescription}
            onConfirm={() => {
              onClose();
              onDiscardAll();
            }}
            portalContainer={portalContainer}
          />
        )}
      </div>
    </FloatingPanel>
  );
}
