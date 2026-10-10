import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Shell } from "../../shell/Shell";
import { mockShellData } from "../../shell/mockShellData";
import type { TopBarProposals } from "../../shell/TopBar";
import {
  NewProposalDialog,
  type NewProposalProblem,
} from "../NewProposalDialog";
import { CloseProposalDialog } from "../CloseProposalDialog";
import { RenameProposalDialog } from "../RenameProposalDialog";
import { AllProposalsDialog, ProposalsList } from "../ProposalsList";
import type { ProposalSummary, StudioLocation } from "../types";

/**
 * Proposals in the Studio: `docs/proposals.md` in valbuild/home, flows B and
 * C. A proposal is a copy of the site an editor changes and saves at its own
 * address, and merges when it is ready.
 *
 * The Shell stories are interactive: the switcher navigates, New proposal
 * opens one, Save runs a save (the address updates, then the render check
 * reports), and Close and Reopen work from the menu and the list.
 */
const meta: Meta = {
  title: "Proposals/Proposals",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

/** One clock for every story, so "2h ago" does not drift between runs. */
const NOW = new Date("2026-10-06T12:00:00Z");
const ago = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const proposals: ProposalSummary[] = [
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
const open = proposals.filter((p) => p.status === "open");

const PUBLISH_LATER =
  "Publishing a proposal arrives with the next part of proposals: for now a proposal is saved and shared.";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
const inProposal = (over: Partial<InProposal> = {}): InProposal => ({
  kind: "proposal",
  proposal: open[0],
  unsaved: 3,
  save: { state: "idle" },
  overlay: { status: "succeeded" },
  renderCheck: { status: "succeeded" },
  publishBlockedBy: PUBLISH_LATER,
  ...over,
});

type HarnessProps = {
  location: StudioLocation;
  list?: ProposalSummary[];
  theme?: "dark" | "light";
  switcherOpen?: boolean;
  menuOpen?: boolean;
  dialog?: "new" | "close" | "rename" | "all" | null;
  newProblem?: NewProposalProblem | null;
};

/**
 * The whole Studio with proposals on, holding the state the app would: where
 * you are, the open dialog, and a save that runs.
 */
function ProposalsShell({
  location: initialLocation,
  list = proposals,
  theme: initialTheme = "dark",
  switcherOpen = false,
  menuOpen = false,
  dialog: initialDialog = null,
  newProblem = null,
}: HarnessProps) {
  const [theme, setTheme] = useState(initialTheme);
  const [location, setLocation] = useState<StudioLocation>(initialLocation);
  const [all, setAll] = useState(list);
  const [dialog, setDialog] = useState(initialDialog);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState(newProblem);
  const [reopening, setReopening] = useState<string | null>(null);

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

  const goTo = (name: string) => {
    const proposal = all.find((p) => p.name === name);
    if (proposal) {
      setLocation(inProposal({ proposal, unsaved: 0 }));
      setDialog(null);
    }
  };
  const handlers: TopBarProposals = {
    location,
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
    onPublish: () => undefined,
    onCompare: () => console.log("compare with the site"),
    onRename: () => setDialog("rename"),
    onCopyLink: () => console.log("copy link"),
    onClose: () => setDialog("close"),
    defaultSwitcherOpen: switcherOpen,
    defaultMenuOpen: menuOpen,
  };
  const current = location.kind === "proposal" ? location.proposal : null;
  return (
    <>
      <Shell
        data={mockShellData}
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
        onCompare={() => console.log("open the review view")}
        mode="http"
        proposals={handlers}
      />
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

type ShellStory = StoryObj<typeof ProposalsShell>;
const shell = (args: HarnessProps): ShellStory => ({
  render: () => <ProposalsShell {...args} />,
});

/** On the site, as every project with proposals starts: the switcher says so. */
export const OnTheSite = shell({ location: { kind: "site" } });

/** The switcher, open: the site, the open proposals, and the two ways on. */
export const SwitcherOpen = shell({
  location: { kind: "site" },
  switcherOpen: true,
});

/** A project with no proposal yet: the switcher says what one is. */
export const SwitcherWithNoProposals = shell({
  location: { kind: "site" },
  list: [],
  switcherOpen: true,
});

/**
 * In a proposal: the bar wears the proposal colour, the switcher names it, and
 * Save takes Publish's place. Press Save to run one.
 */
export const InAProposal = shell({ location: inProposal() });

/** Nothing unsaved: Save is off, and Merge reads plain "Merge". */
export const InAProposalAllSaved = shell({
  location: inProposal({ unsaved: 0 }),
});

/** The proposal's menu: compare, rename, copy its link, close. */
export const InAProposalMenuOpen = shell({
  location: inProposal(),
  menuOpen: true,
});

/** The switcher from inside a proposal: "here" is the proposal. */
export const InAProposalSwitcherOpen = shell({
  location: inProposal(),
  switcherOpen: true,
});

/** Publish enabled, as it will be once merging exists: the site's own green. */
export const InAProposalReadyToPublish = shell({
  location: inProposal({ publishBlockedBy: null }),
});

export const Saving = shell({
  location: inProposal({ save: { state: "saving" } }),
});

/** A save that failed says why, before anything else. */
export const SaveFailed = shell({
  location: inProposal({
    save: {
      state: "failed",
      error: "Some of these changes were changed while they were being saved",
    },
  }),
});

export const InAProposalLightMode = shell({
  location: inProposal(),
  theme: "light",
});

export const NewProposal = shell({
  location: { kind: "site" },
  dialog: "new",
});

/**
 * The same empty proposal of this version of the site already exists: what a
 * content service from before every New proposal was a new one answers.
 */
export const NewProposalAlreadyExists = shell({
  location: { kind: "site" },
  dialog: "new",
  newProblem: {
    kind: "exists",
    name: open[0].name,
    displayName: open[0].displayName,
  },
});

/** Rename: what people call it changes; its address and link do not. */
export const RenameAProposal = shell({
  location: inProposal(),
  dialog: "rename",
});

export const CloseAProposal = shell({
  location: inProposal(),
  dialog: "close",
});

/**
 * Close, on a proposal stuck being published -- pressed on a phone that could
 * not build it, say. Closing stops that publish first: a merging proposal is
 * never a dead end.
 */
export const CloseWhilePublishing: StoryObj = {
  render: () => (
    <CloseProposalDialog
      open
      onOpenChange={() => {}}
      displayName="Spring campaign"
      changes={3}
      merging
      onConfirm={() => {}}
    />
  ),
};

export const AllProposals = shell({
  location: { kind: "site" },
  dialog: "all",
});

/** The list on its own, as each tab and state reads. */
export const ListOpen: StoryObj = {
  render: () => (
    <ListFrame>
      <ProposalsList
        proposals={proposals}
        now={NOW}
        onOpen={console.log}
        onReopen={console.log}
        onNewProposal={() => undefined}
      />
    </ListFrame>
  ),
};

export const ListClosed: StoryObj = {
  render: () => (
    <ListFrame>
      <ProposalsList
        proposals={proposals}
        now={NOW}
        defaultTab="closed"
        onOpen={console.log}
        onReopen={console.log}
        onNewProposal={() => undefined}
      />
    </ListFrame>
  ),
};

export const ListEmpty: StoryObj = {
  render: () => (
    <ListFrame>
      <ProposalsList
        proposals={[]}
        now={NOW}
        onOpen={console.log}
        onReopen={console.log}
        onNewProposal={() => undefined}
      />
    </ListFrame>
  ),
};

export const ListLoading: StoryObj = {
  render: () => (
    <ListFrame>
      <ProposalsList
        proposals={[]}
        loading
        onOpen={console.log}
        onReopen={console.log}
        onNewProposal={() => undefined}
      />
    </ListFrame>
  ),
};

function ListFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg-canvas p-6">
      <div className="h-[30rem] w-full max-w-xl rounded-lg border border-border-float bg-bg-float shadow-sm">
        {children}
      </div>
    </div>
  );
}

/*
 * ON A PHONE. The shell reads the viewport, so these are the same stories at
 * 390px: open them with Storybook's mobile viewport, or the screenshots.
 */
export const PhoneOnTheSite = shell({ location: { kind: "site" } });
export const PhoneInAProposal = shell({ location: inProposal() });
export const PhoneProposalMenu = shell({
  location: inProposal(),
  menuOpen: true,
});
export const PhoneSwitcherOpen = shell({
  location: inProposal(),
  switcherOpen: true,
});
