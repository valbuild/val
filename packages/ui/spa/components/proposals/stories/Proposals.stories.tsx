import type { Meta, StoryObj } from "@storybook/react";
import { CloseProposalDialog } from "../CloseProposalDialog";
import { ProposalsList } from "../ProposalsList";
import { mockSelectionIds } from "../../shell/mockShellData";
import {
  NOW,
  PASSING_CHECKS,
  inProposal,
  open,
  proposals,
  shell,
} from "./proposalsShellHarness";

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
 * Save stands where Publish is on the site. Press Save to run one: once it is
 * done, the same button is Publish.
 */
export const InAProposal = shell({ location: inProposal() });

/** Everything saved: Save has become Publish. */
export const InAProposalAllSaved = shell({
  location: inProposal({ unsaved: 0 }),
});

/** Ready to publish, with the caret open. */
export const InAProposalAllSavedMenuOpen = shell({
  location: inProposal({ unsaved: 0 }),
  menuOpen: true,
});

/**
 * A page open in a proposal: what an editor mostly looks at. The bar is the
 * only thing that says where the edits go.
 */
export const InAProposalEditingAPage = shell({
  location: inProposal(),
  selectionId: mockSelectionIds.home,
});

/** Publish, pressed: the merge checks, then Publish. */
export const PublishFromAProposal = shell({
  location: inProposal(),
  selectionId: mockSelectionIds.home,
  dialog: "publish",
  publishState: {
    kind: "ready",
    checks: PASSING_CHECKS,
    changes: 18,
    unsaved: 3,
  },
});

/**
 * At a published proposal's address: finished, said above the editor, with
 * the ways on.
 */
export const PublishedProposal = shell({
  location: inProposal({
    unsaved: 0,
    proposal: { ...open[0]!, status: "merged" },
    publishBlockedBy:
      "It is published: this proposal is finished. Anything more starts a new one.",
  }),
  selectionId: mockSelectionIds.home,
  merged: { continuedIn: null },
});

/** Changes made while it was being published went to a new proposal. */
export const PublishedProposalContinued = shell({
  location: inProposal({
    unsaved: 0,
    proposal: { ...open[0]!, status: "merged" },
    publishBlockedBy:
      "It is published: this proposal is finished. Anything more starts a new one.",
  }),
  selectionId: mockSelectionIds.home,
  merged: { continuedIn: "Spring campaign (continued)" },
});

/**
 * The caret beside Save: every step, Publish among them -- it saves first --
 * and below them what was the proposal's own menu: compare, rename, copy its
 * link, close.
 */
export const InAProposalMenuOpen = shell({
  location: inProposal(),
  menuOpen: true,
});

/** The switcher from inside a proposal: "here" is the proposal. */
export const InAProposalSwitcherOpen = shell({
  location: inProposal(),
  switcherOpen: true,
});

/**
 * Publish refused, saying why on hover: here, the proposal is being brought
 * up to date with the site.
 */
export const InAProposalPublishBlocked = shell({
  location: inProposal({
    unsaved: 0,
    publishBlockedBy: "It is being brought up to date with the site.",
  }),
  menuOpen: true,
});

/*
 * AFTER A SAVE. The proposal's address catches up with the save, then is
 * checked to still render: said beside the switcher while it runs, and when
 * it fails.
 */

/** A new proposal, while its address is being made. */
export const SettingUp = shell({
  location: inProposal({
    unsaved: 0,
    proposal: { ...open[0]!, changes: 0, setup: { status: "running" } },
    overlay: null,
    renderCheck: null,
  }),
});

export const UpdatingThePreview = shell({
  location: inProposal({
    unsaved: 0,
    overlay: { status: "running" },
    renderCheck: null,
  }),
});

export const CheckingThePreview = shell({
  location: inProposal({ unsaved: 0, renderCheck: { status: "running" } }),
});

/** The pages did not render after the save: said, with why on hover. */
export const PreviewDidNotRender = shell({
  location: inProposal({
    unsaved: 0,
    renderCheck: {
      status: "failed",
      error: "/products answered 500",
    },
  }),
});

export const Saving = shell({
  location: inProposal({ save: { state: "saving" } }),
});

/**
 * Unsaved changes the schema says are invalid: Save is "Fix 2" and goes to
 * them, as the site's Publish does, instead of being refused by the server.
 */
export const SaveBlockedByValidationErrors = shell({
  location: inProposal(),
  validationErrors: 2,
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

/*
 * CODE IN A PROPOSAL (valbuild/home `docs/hosted-publishing.md`, step 7). The
 * assistant staged files: the preview shows them once the proposal is built.
 */
export const BuildRequired = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
});

/** Build is next, and Publish is still in the menu: it builds first. */
export const BuildRequiredMenuOpen = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
  menuOpen: true,
});

export const Building = shell({
  location: inProposal({ unsaved: 0, code: { state: "building" } }),
});

/** A failed build says so on the button, with why, and builds again when pressed. */
export const BuildFailed = shell({
  location: inProposal({
    unsaved: 0,
    code: {
      state: "failed",
      error:
        "Could not build: src/components/Hero.tsx: Unexpected token (3:12)",
    },
  }),
});

export const PhoneBuildRequired = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
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
/** The chip, pressed: the proposal named in full, its acts, and the way out. */
export const PhoneProposalSheet = shell({
  location: inProposal(),
  panel: "proposals",
});
/** The same chip on the site: the way into a proposal. */
export const PhoneSiteSheet = shell({
  location: { kind: "site" },
  panel: "proposals",
});
/** The caret beside Save: everything else to do with the changes. */
export const PhoneChangesSheet = shell({
  location: inProposal({ code: { state: "required" } }),
  panel: "changes",
});
/** Saved and built: the one action is Publish. */
export const PhoneReadyToPublish = shell({
  location: inProposal({ unsaved: 0 }),
});
