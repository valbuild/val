import { useEffect, useState } from "react";
import type { StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { themeCustomProperties } from "@valbuild/shared/internal";
import { ArrowUpCircle } from "lucide-react";
import type { FloatingNoticeItem } from "../../shell/FloatingNotices";
import { Shell } from "../../shell/Shell";
import { mockShellData } from "../../shell/mockShellData";
import type { TopBarProposals } from "../../shell/TopBar";
import type { ShellPanel } from "../../shell/types";
import type { ProposalUpgrade } from "../../../proposals/proposalsClient";
import { UpgradeNotice, type UpgradeButton } from "../../../upgrade/useUpgrade";
import {
  NewProposalDialog,
  type NewProposalProblem,
} from "../NewProposalDialog";
import { CloseProposalDialog } from "../CloseProposalDialog";
import { RenameProposalDialog } from "../RenameProposalDialog";
import { AllProposalsDialog } from "../ProposalsList";
import { MergedProposalDialog } from "../MergedProposalDialog";
import {
  PublishProposalDialog,
  type MergeCheckView,
  type PublishProposalState,
} from "../PublishProposalDialog";
import { UpgradeProposalNotice } from "../UpgradeProposalNotice";
import type { ProposalSummary, StudioLocation } from "../types";

/**
 * The whole Studio with proposals on, for the proposals stories: what
 * `useProposalsBar` and `useUpgrade` hand `ValShell`, held as story state.
 * The switcher navigates, New proposal opens one, Save runs a save, and
 * Close, Rename, Publish and Reopen open their dialogs.
 */

/** One clock for every story, so "2h ago" does not drift between runs. */
export const NOW = new Date("2026-10-06T12:00:00Z");
const ago = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

export const proposals: ProposalSummary[] = [
  {
    name: "a1b2c3d4e5f6a7b8c9d0",
    displayName: "Spring campaign",
    description: "Rewrite of all product copy for the spring launch",
    status: "open",
    owner: { name: "Fredrik Ekholdt" },
    ownedByViewer: true,
    changes: 15,
    updatedAt: ago(120),
    setup: { status: "succeeded" },
  },
  {
    name: "b2c3d4e5f6a7b8c9d0e1",
    displayName: "New pricing page",
    description: null,
    status: "open",
    owner: { name: "Kari Nordmann" },
    ownedByViewer: false,
    changes: 4,
    updatedAt: ago(60 * 26),
    setup: { status: "succeeded" },
  },
  {
    name: "c3d4e5f6a7b8c9d0e1f2",
    displayName: "Autumn sale",
    description: "Banner and product discounts",
    status: "merged",
    owner: { name: "Kari Nordmann" },
    ownedByViewer: false,
    changes: 9,
    updatedAt: ago(60 * 24 * 12),
  },
  {
    name: "d4e5f6a7b8c9d0e1f2a3",
    displayName: "Try a darker hero",
    description: "An experiment",
    status: "closed",
    owner: { name: "Fredrik Ekholdt" },
    ownedByViewer: true,
    changes: 2,
    updatedAt: ago(60 * 24 * 3),
    closedBy: { name: "Kari Nordmann" },
  },
];
export const open = proposals.filter((p) => p.status === "open");

/**
 * An upgrade proposal, as Val Build makes one: named after its kind
 * (`upgradeDisplayName` in valbuild/home), with no content changes.
 */
export const upgradeProposal: ProposalSummary = {
  name: "e5f6a7b8c9d0e1f2a3b4",
  displayName: "Minor versions",
  description: null,
  status: "open",
  owner: { name: "Fredrik Ekholdt" },
  ownedByViewer: true,
  changes: 0,
  upgrade: true,
  updatedAt: ago(15),
  setup: { status: "succeeded" },
};

/** What a "latest" upgrade stages: Val, its framework, and a few more. */
export const minorUpgrade: ProposalUpgrade = {
  path: "latest",
  state: "staged",
  changes: [
    {
      name: "@valbuild/tanstack",
      from: "0.149.4",
      to: "0.149.7",
      kind: "patch",
    },
    { name: "@valbuild/core", from: "0.149.4", to: "0.149.7", kind: "patch" },
    { name: "@valbuild/ui", from: "0.149.4", to: "0.149.7", kind: "patch" },
    {
      name: "@tanstack/react-router",
      from: "1.120.3",
      to: "1.121.0",
      kind: "minor",
    },
    {
      name: "@tanstack/react-start",
      from: "1.120.3",
      to: "1.121.0",
      kind: "minor",
    },
    { name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" },
  ],
  vulnerableBefore: 0,
  vulnerableAfter: 0,
  error: null,
};

export const PASSING_CHECKS: MergeCheckView[] = [
  {
    id: "published-since",
    ok: true,
    message: "Nobody has published to these pages since this proposal started",
  },
  {
    id: "pending-on-site",
    ok: true,
    message: "Nobody has unpublished changes on these pages",
  },
];

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
export const inProposal = (over: Partial<InProposal> = {}): InProposal => ({
  kind: "proposal",
  proposal: open[0]!,
  unsaved: 3,
  save: { state: "idle" },
  overlay: { status: "succeeded" },
  renderCheck: { status: "succeeded" },
  publishBlockedBy: null,
  code: null,
  ...over,
});

/** At an upgrade proposal's address, as Val Build's "Open the proposal" lands. */
export const inUpgrade = (over: Partial<InProposal> = {}): InProposal =>
  inProposal({ proposal: upgradeProposal, unsaved: 0, ...over });

export type HarnessProps = {
  location: StudioLocation;
  list?: ProposalSummary[];
  theme?: "dark" | "light";
  switcherOpen?: boolean;
  /** The Save/Publish button's caret menu, open: the proposal's acts too. */
  menuOpen?: boolean;
  dialog?: "new" | "close" | "rename" | "all" | "publish" | null;
  newProblem?: NewProposalProblem | null;
  /** Validation errors a save would be refused for. */
  validationErrors?: number;
  /** A panel open from the start: the phone's sheets, say. */
  panel?: ShellPanel;
  /** A page open in the editor, by id: `mockSelectionIds`. */
  selectionId?: string;
  /** Where Publish is, when its dialog is open. */
  publishState?: PublishProposalState;
  /**
   * The upgrade the current proposal is: the notice above the editor says
   * what it upgrades, as `useUpgrade` has it.
   */
  upgrade?: ProposalUpgrade;
  /** On the site: an upgrade under way in Val Build, by its name. */
  upgradeUnderWay?: string;
  /** The top bar's Updates button: there is something to upgrade. */
  updates?: UpgradeButton;
  /**
   * The current proposal is published: finished, said above the editor, with
   * where its later changes went, if anywhere.
   */
  merged?: { continuedIn: string | null };
  /** The floating notices, dismissed: folded into the status bar. */
  noticesDismissed?: boolean;
  /** Where the Studio is, or which proposal, still being read. */
  loading?: boolean;
  /** On the way to another address. */
  leaving?: string;
  /** The project's own proposal colour, from `theme.proposal`. */
  proposalColor?: string;
};

/**
 * The whole Studio with proposals on, holding the state the app would: where
 * you are, the open dialog, and a save that runs.
 */
export function ProposalsShell({
  location: initialLocation,
  list = proposals,
  theme: initialTheme = "dark",
  switcherOpen = false,
  menuOpen = false,
  dialog: initialDialog = null,
  newProblem = null,
  validationErrors = 0,
  panel,
  selectionId,
  publishState: initialPublishState,
  upgrade,
  upgradeUnderWay,
  updates,
  merged,
  noticesDismissed = false,
  loading = false,
  leaving,
  proposalColor,
}: HarnessProps) {
  const [theme, setTheme] = useState(initialTheme);
  const [location, setLocation] = useState<StudioLocation>(initialLocation);
  const [all, setAll] = useState(list);
  const [dialog, setDialog] = useState(initialDialog);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState(newProblem);
  const [reopening, setReopening] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishProposalState>(
    initialPublishState ?? { kind: "checking" },
  );

  // A save, as the app sees one: committing, then the address catching up,
  // then the render check.
  const [saveStep, setSaveStep] = useState(0);
  useEffect(() => {
    if (saveStep === 0 || location.kind !== "proposal") return;
    const next = (patch: Partial<InProposal>, then: number) =>
      setTimeout(() => {
        setLocation((current) =>
          current.kind === "proposal" ? { ...current, ...patch } : current,
        );
        setSaveStep(then);
      }, 900);
    const timer =
      saveStep === 1
        ? next(
            {
              save: { state: "idle" },
              unsaved: 0,
              overlay: { status: "running" },
              renderCheck: null,
            },
            2,
          )
        : saveStep === 2
          ? next(
              {
                overlay: { status: "succeeded" },
                renderCheck: { status: "running" },
              },
              3,
            )
          : next({ renderCheck: { status: "succeeded" } }, 0);
    return () => clearTimeout(timer);
  }, [saveStep, location.kind]);

  const current = location.kind === "proposal" ? location.proposal : null;
  const isUpgrade = current?.upgrade === true;

  const openPublish = () => {
    setDialog("publish");
    if (initialPublishState !== undefined) return;
    // The checks, as the app reads them when the dialog opens.
    setPublishState({ kind: "checking" });
    setTimeout(
      () =>
        setPublishState({
          kind: "ready",
          checks: PASSING_CHECKS,
          changes: current?.changes ?? 0,
          unsaved: location.kind === "proposal" ? location.unsaved : 0,
        }),
      700,
    );
  };

  const goTo = (name: string) => {
    const proposal = all.find((p) => p.name === name);
    if (proposal) {
      setLocation(inProposal({ proposal, unsaved: 0 }));
      setDialog(null);
    }
  };
  /*
   * Publish is refused while the upgrade is not staged, as
   * `publishBlockedByUpgrade` in `useProposalsBar` refuses it.
   */
  const barLocation: StudioLocation =
    location.kind === "proposal" &&
    upgrade !== undefined &&
    upgrade.state !== "staged" &&
    location.publishBlockedBy === null
      ? {
          ...location,
          publishBlockedBy:
            upgrade.state === "computing"
              ? "Val Build is still working out this upgrade. It can be published once it is checked."
              : upgrade.state === "failed"
                ? "This upgrade could not be worked out. Val Build has the details."
                : "There is nothing to upgrade: the site is up to date.",
        }
      : location;
  const handlers: TopBarProposals = {
    location: barLocation,
    loading,
    leaving: leaving ?? null,
    ...(validationErrors > 0
      ? {
          saveBlockedBy: {
            errors: validationErrors,
            onShow: action("show the validation errors"),
          },
        }
      : {}),
    open: all.filter((p) => p.status === "open"),
    onOpenSite: () => setLocation({ kind: "site" }),
    onOpenProposal: goTo,
    onNewProposal: () => {
      setProblem(null);
      setDialog("new");
    },
    onShowAllProposals: () => setDialog("all"),
    onSave: () => {
      setLocation((current) =>
        current.kind === "proposal"
          ? { ...current, save: { state: "saving" } }
          : current,
      );
      setSaveStep(1);
    },
    // An upgrade is built in Val Build, as in `useProposalsBar`.
    ...(isUpgrade
      ? {}
      : {
          onBuild: () =>
            setLocation((current) =>
              current.kind === "proposal"
                ? { ...current, code: { state: "building" } }
                : current,
            ),
        }),
    onPublish: openPublish,
    onCompare: action("compare with the site"),
    onRename: () => setDialog("rename"),
    onCopyLink: action("copy link"),
    onClose: () => setDialog("close"),
    defaultSwitcherOpen: switcherOpen,
    defaultMenuOpen: menuOpen,
  };

  /*
   * Popping up from below, in `useProposalsBar`'s order: merged, then the
   * upgrade; on the site, an upgrade under way. Ids as the app makes them.
   */
  const floatingNotices: FloatingNoticeItem[] = [];
  if (current !== null && upgrade !== undefined && merged === undefined) {
    const contentChanges =
      location.kind === "proposal"
        ? location.proposal.changes + location.unsaved
        : 0;
    floatingNotices.push({
      id: `upgrade:${current.name}:${upgrade.state}:${contentChanges > 0}`,
      label: "About this upgrade",
      icon: <ArrowUpCircle size={13} />,
      content: (
        <UpgradeProposalNotice
          upgrade={upgrade}
          siteName="quiet-harbor-24"
          checksHref="#val-build"
          contentChanges={contentChanges}
        />
      ),
    });
  } else if (location.kind === "site" && upgradeUnderWay !== undefined) {
    floatingNotices.push({
      id: `upgrade-under-way:${upgradeUnderWay}`,
      label: "Upgrade under way",
      icon: <ArrowUpCircle size={13} />,
      content: (
        <UpgradeNotice
          text={`${upgradeUnderWay}: an upgrade is under way in Val Build.`}
          action={{
            label: "Open upgrade",
            onClick: action("open the upgrade in Val Build"),
          }}
        />
      ),
    });
  }

  return (
    <>
      <Shell
        initialPanel={panel ?? null}
        initialSelectionId={selectionId ?? null}
        /*
         * In a proposal the status bar names its branch, as `useShellData`
         * does: its saves are there, never on the site's.
         */
        data={
          current !== null
            ? { ...mockShellData, branch: `val/p/${current.name}` }
            : mockShellData
        }
        theme={theme}
        onThemeChange={setTheme}
        /*
         * In a proposal, Review shows what Publish would publish: the
         * proposal against the site, saved and unsaved alike.
         */
        pendingChanges={
          location.kind === "proposal"
            ? location.proposal.changes + location.unsaved
            : 12
        }
        onCompare={action("open the review view")}
        mode="http"
        proposals={handlers}
        floatingNotices={floatingNotices}
        {...(proposalColor !== undefined
          ? { themeStyle: themeCustomProperties({ proposal: proposalColor }) }
          : {})}
        {...(noticesDismissed
          ? { initialDismissedNotices: floatingNotices.map((each) => each.id) }
          : {})}
        // Hidden at an upgrade's own address, as `useUpgrade` hides it.
        {...(updates !== undefined && !isUpgrade ? { upgrade: updates } : {})}
      />
      {current !== null && (
        <PublishProposalDialog
          open={dialog === "publish"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "publish" : null)}
          displayName={current.displayName}
          {...(upgrade !== undefined ? { upgrade } : {})}
          siteName="quiet-harbor-24"
          state={publishState}
          onPublish={() => {
            setPublishState({ kind: "publishing", step: "building" });
            setTimeout(() => setPublishState({ kind: "merged" }), 1500);
          }}
          onRetry={openPublish}
          onCompare={action("compare with the site")}
          onGoToSite={() => {
            setDialog(null);
            setLocation({ kind: "site" });
          }}
        />
      )}
      {current !== null && merged !== undefined && (
        <MergedProposalDialog
          // As `useProposalsBar`: unless a dialog it led to is open instead.
          open={dialog === null}
          displayName={current.displayName}
          continuedIn={
            merged.continuedIn !== null
              ? { displayName: merged.continuedIn }
              : null
          }
          onOpenContinuation={action("open the continuation")}
          onNewProposal={() => setDialog("new")}
          onShowAllProposals={() => setDialog("all")}
          onGoToSite={() => setLocation({ kind: "site" })}
        />
      )}
      <NewProposalDialog
        open={dialog === "new"}
        onOpenChange={(isOpen) => setDialog(isOpen ? "new" : null)}
        suggestedName="Bright harbour"
        creating={creating}
        problem={problem}
        onOpenExisting={goTo}
        onCreate={({ displayName, description }) => {
          setCreating(true);
          setTimeout(() => {
            const made: ProposalSummary = {
              name: Math.random().toString(16).slice(2, 22).padEnd(20, "0"),
              displayName,
              description: description || null,
              status: "open",
              owner: { name: "Fredrik Ekholdt" },
              ownedByViewer: true,
              changes: 0,
              updatedAt: NOW.toISOString(),
              setup: { status: "running" },
            };
            setAll((list) => [made, ...list]);
            setCreating(false);
            setDialog(null);
            setLocation(
              inProposal({
                proposal: made,
                unsaved: 0,
                overlay: null,
                renderCheck: null,
              }),
            );
            setTimeout(
              () =>
                setLocation((loc) =>
                  loc.kind === "proposal"
                    ? {
                        ...loc,
                        proposal: {
                          ...loc.proposal,
                          setup: { status: "succeeded" },
                        },
                      }
                    : loc,
                ),
              1500,
            );
          }, 900);
        }}
      />
      {current !== null && (
        <RenameProposalDialog
          open={dialog === "rename"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "rename" : null)}
          displayName={current.displayName}
          onRename={(displayName) => {
            const renamed = { ...current, displayName };
            setAll((list) =>
              list.map((p) => (p.name === current.name ? renamed : p)),
            );
            setLocation((loc) =>
              loc.kind === "proposal" ? { ...loc, proposal: renamed } : loc,
            );
            setDialog(null);
          }}
        />
      )}
      {current !== null && (
        <CloseProposalDialog
          open={dialog === "close"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "close" : null)}
          displayName={current.displayName}
          changes={current.changes}
          upgrade={isUpgrade}
          onConfirm={() => {
            setAll((list) =>
              list.map((p) =>
                p.name === current.name
                  ? {
                      ...p,
                      status: "closed",
                      closedBy: { name: "Fredrik Ekholdt" },
                    }
                  : p,
              ),
            );
            setDialog(null);
            setLocation({ kind: "site" });
          }}
        />
      )}
      <AllProposalsDialog
        open={dialog === "all"}
        onOpenChange={(isOpen) => setDialog(isOpen ? "all" : null)}
        proposals={all}
        now={NOW}
        onOpen={goTo}
        onNewProposal={() => setDialog("new")}
        reopening={reopening}
        onReopen={(name) => {
          setReopening(name);
          setTimeout(() => {
            setAll((list) =>
              list.map((p) =>
                p.name === name ? { ...p, status: "open", closedBy: null } : p,
              ),
            );
            setReopening(null);
          }, 800);
        }}
      />
    </>
  );
}

export type ShellStory = StoryObj<typeof ProposalsShell>;
export const shell = (args: HarnessProps): ShellStory => ({
  render: () => <ProposalsShell {...args} />,
});
