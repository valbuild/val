import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Shell } from "../Shell";
import { PublishState } from "../TopBar";
import { SaveState } from "../StatusBar";
import { ShellData, ShellPanel } from "../types";
import {
  emptyShellData,
  mockDeployments,
  mockSelectionIds,
  mockShellData,
} from "../mockShellData";
import { ShellDeployment } from "../types";
import { CanvasView } from "../canvas/PageWorkspace";
import { mockCanvasPage } from "../canvas/mockCanvasPage";

/**
 * The whole shell in one story.
 *
 * Everything is interactive: the rail, the menu button, the top bar buttons
 * and the panel close buttons all work, so a single story is enough to check
 * every layout state. Resize the preview to cross the breakpoints — the shell
 * reads the viewport, so mobile chrome appears below 768px and the left rail
 * appears at 1200px.
 *
 * Dark mode is the default. Switch it from the toolbar, or from the shell's
 * own Settings panel.
 */
const meta: Meta<typeof ShellHarness> = {
  title: "Shell/Shell",
  component: ShellHarness,
  parameters: {
    layout: "fullscreen",
    // The shell paints its own canvas and owns the full viewport.
    backgrounds: { disable: true },
  },
  argTypes: {
    openPanel: {
      control: "select",
      options: [
        null,
        "pages",
        "media",
        "data",
        "settings",
        "utility",
        "ai",
        "notifications",
      ],
      description: "Panel to open on mount",
    },
    selectionId: {
      control: "select",
      // Ids are source paths, so they are picked from the mock rather than
      // typed: a hand-written id that no row has selects nothing, silently.
      options: [null, ...Object.values(mockSelectionIds)],
      description: "Item selected in the editor on mount",
    },
    empty: {
      control: "boolean",
      description: "Render an empty project to check empty states",
    },
    withoutRouters: {
      control: "boolean",
      description:
        "Drop the routers and the galleries, leaving a content-only project",
    },
    searchOpen: {
      control: "boolean",
      description: "Open the global search on mount (⌘K / Ctrl+K)",
    },
    aiEnabled: {
      control: "boolean",
      description:
        "Whether the project has the assistant configured. Off hides the top bar button, the quick action and the panel",
    },
    publishState: {
      control: "select",
      options: ["idle", "publishing", "error"],
      description:
        "Publish button state. Validation errors override this with `blocked`.",
    },
    saveState: {
      control: "select",
      options: ["saved", "saving", "error"],
    },
    isLoading: { control: "boolean", description: "Nav panels still loading" },
    loadError: {
      control: "text",
      description: "Nav panel load failure message",
    },
    withValidationErrors: {
      control: "boolean",
      description: "Include validation errors, which block publishing",
    },
    deployments: {
      control: "select",
      options: ["mixed", "building", "failed", "live", "none", "hidden"],
      description:
        "Deployment feed behind the status bar's deploy item. `hidden` is a project with no feed at all.",
    },
    deploymentsOpen: {
      control: "boolean",
      description: "Open the deployments list on mount, as a publish does",
    },
    simulatePublish: {
      control: "boolean",
      description:
        "Run a publish: a new commit appears after a moment, builds, goes live, and the list closes itself",
    },
    canvasOpen: {
      control: "boolean",
      description:
        "Open the canvas beside the editor. Offered wherever there is a site to look at, not only on a page.",
    },
    canvasView: {
      control: "inline-radio",
      options: ["normal", "fields"],
      description:
        "Normal shows the page as a visitor sees it; Fields swaps the module column for the fields found on the page",
    },
    canvasReported: {
      control: "boolean",
      description:
        "Whether the running site has reported what is on the current route. Until it has, there is nothing to put on a canvas and no Canvas button.",
    },
  },
};
export default meta;

type HarnessProps = {
  openPanel: ShellPanel | null;
  selectionId: string | null;
  empty: boolean;
  withoutRouters: boolean;
  searchOpen: boolean;
  aiEnabled: boolean;
  theme: "dark" | "light";
  publishState: PublishState;
  saveState: SaveState;
  isLoading: boolean;
  loadError: string;
  withValidationErrors: boolean;
  deployments: DeploymentsFixture;
  deploymentsOpen: boolean;
  simulatePublish: boolean;
  canvasOpen: boolean;
  canvasView: CanvasView;
  canvasReported: boolean;
};

type DeploymentsFixture =
  | "mixed"
  | "building"
  | "failed"
  | "live"
  | "none"
  | "hidden";

/**
 * The feed each fixture stands for.
 *
 * The status bar only ever summarises one thing, so each fixture is the
 * smallest feed that produces a different summary.
 */
function deploymentsFor(
  fixture: DeploymentsFixture,
): ShellDeployment[] | undefined {
  switch (fixture) {
    case "hidden":
      return undefined;
    case "none":
      return [];
    case "mixed":
      return mockDeployments;
    case "building":
      return mockDeployments.filter((d) => d.state === "pending");
    case "failed":
      return mockDeployments.filter((d) => d.state === "failure");
    case "live":
      return mockDeployments.filter((d) => d.state === "success");
  }
}

/**
 * Owns the theme so the Settings panel's own theme switch works inside the
 * story, and keys the shell on the mount-time args so changing a control
 * remounts it into that state.
 */
function ShellHarness({
  openPanel,
  selectionId,
  empty,
  withoutRouters,
  aiEnabled,
  searchOpen,
  theme,
  publishState,
  saveState,
  isLoading,
  loadError,
  withValidationErrors,
  deployments,
  deploymentsOpen,
  simulatePublish,
  canvasOpen,
  canvasView,
  canvasReported,
}: HarnessProps) {
  const [currentTheme, setCurrentTheme] = useState<"dark" | "light">(theme);
  /**
   * Held here because the real one lives in `localStorage` behind
   * `useAutoPublish`, which needs a running system. `mode="fs"` below for the
   * same reason the toggle is gated on it: auto save is a dev-server setting,
   * and a story that did not say so would render a shell where it is hidden.
   */
  const [autoSave, setAutoSave] = useState(false);
  const full = empty ? emptyShellData : mockShellData;
  // A project of nothing but content files: no `s.router`, no `s.images()`.
  // The shell answers by showing one destination instead of three.
  const base: ShellData = withoutRouters
    ? { ...full, hasRouters: false, pages: [], externalPages: [], media: [] }
    : full;
  const withErrors = withValidationErrors
    ? base
    : { ...base, validationErrors: [] };
  const published = useSimulatedPublish(simulatePublish);
  const feed = deploymentsFor(deployments);
  const data = {
    ...withErrors,
    deployments: published && feed ? [published, ...feed] : feed,
  };
  return (
    <Shell
      key={`${openPanel}-${selectionId}-${empty}-${withoutRouters}-${aiEnabled}-${searchOpen}-${isLoading}-${loadError}-${deployments}-${deploymentsOpen}-${canvasOpen}-${canvasView}-${canvasReported}`}
      data={data}
      initialPanel={openPanel}
      initialSelectionId={selectionId}
      initialSearchOpen={searchOpen}
      aiEnabled={aiEnabled}
      theme={currentTheme}
      onThemeChange={setCurrentTheme}
      pendingChanges={empty ? 0 : 12}
      publishState={publishState}
      saveState={saveState}
      mode="fs"
      autoSave={autoSave}
      onAutoSaveChange={setAutoSave}
      isLoading={isLoading}
      loadError={loadError || undefined}
      initialDeploymentsOpen={deploymentsOpen}
      canvasPage={canvasReported ? mockCanvasPage : undefined}
      initialCanvasOpen={canvasOpen}
      initialCanvasView={canvasView}
    />
  );
}

/**
 * A publish, as the shell sees one: a commit it has not seen before appears,
 * builds for a few seconds, then goes live.
 *
 * This is the only way to see the list open by itself and close itself again
 * — mounting with it open is a different thing, and deliberately does not
 * auto-close.
 */
function useSimulatedPublish(enabled: boolean): ShellDeployment | null {
  const [deployment, setDeployment] = useState<ShellDeployment | null>(null);
  useEffect(() => {
    if (!enabled) {
      setDeployment(null);
      return;
    }
    const base: ShellDeployment = {
      commitSha: "f00dcafe1234567890abcdef1234567890abcdef",
      state: "pending",
      message: "Rewrite the pricing page",
      author: "Fredrik Ekholdt",
      timestamp: "just now",
      updatedAt: new Date().toISOString(),
      isLive: false,
    };
    const started = setTimeout(() => setDeployment(base), 1500);
    const finished = setTimeout(
      () => setDeployment({ ...base, state: "success", isLive: true }),
      5500,
    );
    return () => {
      clearTimeout(started);
      clearTimeout(finished);
    };
  }, [enabled]);
  return deployment;
}

type Story = StoryObj<typeof ShellHarness>;

/** Nothing open: the resting state, and where the empty editor shows. */
export const Default: Story = {
  args: {
    openPanel: null,
    selectionId: null,
    empty: false,
    withoutRouters: false,
    searchOpen: false,
    aiEnabled: true,
    theme: "dark",
    publishState: "idle",
    saveState: "saved",
    canvasReported: true,
    isLoading: false,
    loadError: "",
    withValidationErrors: false,
    deployments: "live",
    deploymentsOpen: false,
    simulatePublish: false,
    canvasOpen: false,
    canvasView: "normal",
  },
};

/** A page open in the editor, no chrome in the way. */
export const EditingAPage: Story = {
  args: { ...Default.args, selectionId: mockSelectionIds.home },
};

/**
 * The Pages panel: the site map first, external pages at the end of the same
 * list. Both are pages as far as an editor is concerned.
 */
export const PagesPanelOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "pages",
    selectionId: mockSelectionIds.home,
  },
};

/** Media galleries, by directory. */
export const MediaPanelOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "media",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * Non-router val modules, as the tree they are in.
 *
 * The mock nests deliberately — `/content/shop/shipping` as well as modules
 * sitting at the top of a directory, and more than one top-level directory —
 * because a project that keeps everything in one flat folder would never show
 * the tree doing anything. The selected module is a nested one, so this also
 * shows the panel opening the directories down to it.
 */
export const DataPanelOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "data",
    selectionId: mockSelectionIds.products,
  },
};

/** The narrow right utility panel: quick actions and recent activity. */
export const UtilityPanelOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "utility",
    selectionId: mockSelectionIds.home,
  },
};

/** The assistant, floating over the editor rather than resizing it. */
export const AIChatOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "ai",
    selectionId: mockSelectionIds.home,
  },
};

/** The notification centre. */
export const NotificationsOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "notifications",
    selectionId: mockSelectionIds.home,
  },
};

/** Account and workspace settings — and, on mobile, the status controls. */
export const SettingsOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "settings",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * Global search: ⌘K / Ctrl+K from anywhere, or the top bar's search button.
 * Distinct from a panel's filter, which only narrows the list in front of you.
 */
export const GlobalSearchOpen: Story = {
  args: {
    ...Default.args,
    searchOpen: true,
    selectionId: mockSelectionIds.home,
  },
};

/** Nav panels while their data loads: placeholder rows, no filter yet. */
export const Loading: Story = {
  args: { ...Default.args, openPanel: "pages", isLoading: true },
};

/** The nav data could not be loaded. */
export const LoadFailed: Story = {
  args: {
    ...Default.args,
    openPanel: "pages",
    loadError: "Could not load pages. The dev server may have restarted.",
  },
};

/** Mid-publish: the button is busy and cannot be clicked again. */
export const Publishing: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    publishState: "publishing",
  },
};

/** The publish failed. */
export const PublishFailed: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    publishState: "error",
  },
};

/** Auto save could not write to the working tree. */
export const SaveFailed: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    saveState: "error",
  },
};

/**
 * Validation errors block publishing, so the count sits next to the button it
 * blocks, and the utility panel leads with them.
 */
export const WithValidationErrors: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.products,
    openPanel: "utility",
    withValidationErrors: true,
  },
};

/** Light mode. Dark is the default, but both are first-class. */
export const LightMode: Story = {
  args: {
    ...Default.args,
    theme: "light",
    openPanel: "pages",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * A brand new project: the router is there, nothing has been made yet.
 *
 * Only Pages is on the rail. Media and Data are not empty here so much as
 * absent — an `s.images()` module with no files still lists as a gallery, so a
 * project with no galleries at all has nothing for Media to be about.
 */
export const EmptyProject: Story = {
  args: { ...Default.args, empty: true, openPanel: "pages" },
};

/**
 * A project of content files and nothing else — no `s.router`, no galleries.
 *
 * The rail is one icon. Val does not insist a project use all of it, and an
 * icon that opens a panel with nothing behind it reads as something broken
 * rather than as something this project does not use.
 *
 * The canvas is still on offer: it is a browser pointed at a URL, and a project
 * whose routes Val does not track still has a site to look at while editing the
 * content those routes render.
 */
export const ContentOnlyProject: Story = {
  args: { ...Default.args, withoutRouters: true, openPanel: "data" },
};

/**
 * Straight after Publish: the list opens itself, because the build finishes
 * somewhere Val is not. Closing it leaves the summary in the status bar, which
 * is how you get back to it.
 */
export const JustPublished: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "mixed",
    deploymentsOpen: true,
  },
};

/** The same feed with the list closed: one line in the corner, still building. */
export const Building: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "building",
  },
};

/**
 * A build that failed. The only red on the bar, and the only state that says
 * something the editor has to act on.
 */
export const BuildFailed: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "failed",
    deploymentsOpen: true,
  },
};

/** Nothing published yet: the list explains what will show up here. */
export const NothingPublishedYet: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "none",
    deploymentsOpen: true,
  },
};

/**
 * A project with no deployment feed at all. The deploy item is gone rather
 * than sitting there saying nothing.
 */
export const NoDeploymentFeed: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "hidden",
  },
};

/** On mobile the status bar is gone, so the feed lives in Settings. */
export const DeploymentsOnMobile: Story = {
  args: {
    ...Default.args,
    openPanel: "settings",
    deployments: "mixed",
  },
};

/**
 * The whole round trip, live: wait a moment and a publish appears on its own,
 * builds, goes live, and the list gets out of the way. Hovering the list holds
 * it open while you read.
 */
export const PublishRoundTrip: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    deployments: "live",
    simulatePublish: true,
  },
};

/**
 * The default: a page opens in the module editor, exactly as before. The
 * Canvas button in the top bar is the only sign the canvas exists.
 */
export const PageWithCanvasAvailable: Story = {
  args: { ...Default.args, selectionId: mockSelectionIds.home },
};

/**
 * Canvas added. The module editor does not go anywhere — it narrows, and the
 * page arrives beside it. Links on the page work; nothing is outlined,
 * because in this view the page is for reading, not for aiming at.
 */
export const CanvasNormalView: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    canvasOpen: true,
  },
};

/**
 * The switch on the canvas: the module column is swapped for the fields Val
 * actually found on the page, and every one of them is outlined over there.
 * Clicking either side selects in both.
 */
export const CanvasFieldsView: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    canvasOpen: true,
    canvasView: "fields",
  },
};

/** The canvas with the Pages panel open over it — panels still float. */
export const CanvasWithPanelOpen: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    canvasOpen: true,
    openPanel: "pages",
  },
};

/**
 * Nothing to put on the canvas.
 *
 * There is no Preview split button at all, rather than one that opens an empty
 * frame. In the app there is always the running site, so this is a Storybook
 * state: the harness is not passing a page and there is no site to frame.
 */
export const CanvasNotReported: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    canvasReported: false,
  },
};

/**
 * A data module, with the canvas open on the root.
 *
 * The canvas is offered everywhere — the Preview button does not come and go
 * with the selection — so a link can put it beside anything, and with no page
 * selected it shows the site's root. *Picking* a data module in the navigation
 * is a different act, and closes it: that is a decision to go and edit the
 * module, and in the fields view the canvas was covering the very thing that
 * was just picked.
 */
export const CanvasOnADataModule: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.products,
    canvasOpen: true,
  },
};

/** On a phone the two halves are panes you swipe between, canvas second. */
export const CanvasOnMobile: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    canvasOpen: true,
  },
};
