import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Shell } from "../Shell";
import { PublishState } from "../TopBar";
import { SaveState } from "../StatusBar";
import { ShellPanel } from "../types";
import {
  emptyShellData,
  mockDeployments,
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
      options: [null, "home", "pricing", "data-products", "ext-ig"],
      description: "Item selected in the editor on mount",
    },
    empty: {
      control: "boolean",
      description: "Render an empty project to check empty states",
    },
    searchOpen: {
      control: "boolean",
      description: "Open the global search on mount (⌘K / Ctrl+K)",
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
        "Open the canvas beside the editor. Only offered on a Val-tracked page.",
    },
    canvasView: {
      control: "inline-radio",
      options: ["normal", "fields"],
      description:
        "Normal shows the page as a visitor sees it; Fields swaps the module column for the fields found on the page",
    },
  },
};
export default meta;

type HarnessProps = {
  openPanel: ShellPanel | null;
  selectionId: string | null;
  empty: boolean;
  searchOpen: boolean;
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
}: HarnessProps) {
  const [currentTheme, setCurrentTheme] = useState<"dark" | "light">(theme);
  const base = empty ? emptyShellData : mockShellData;
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
      key={`${openPanel}-${selectionId}-${empty}-${searchOpen}-${isLoading}-${loadError}-${deployments}-${deploymentsOpen}-${canvasOpen}-${canvasView}`}
      data={data}
      initialPanel={openPanel}
      initialSelectionId={selectionId}
      initialSearchOpen={searchOpen}
      theme={currentTheme}
      onThemeChange={setCurrentTheme}
      pendingChanges={empty ? 0 : 12}
      publishState={publishState}
      saveState={saveState}
      isLoading={isLoading}
      loadError={loadError || undefined}
      initialDeploymentsOpen={deploymentsOpen}
      canvasPage={mockCanvasPage}
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
      commitSha: "f00dcafe12345678",
      state: "pending",
      message: "Rewrite the pricing page",
      author: "Fredrik Ekholdt",
      timestamp: "just now",
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
    searchOpen: false,
    theme: "dark",
    publishState: "idle",
    saveState: "saved",
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
  args: { ...Default.args, selectionId: "home" },
};

/**
 * The Pages panel: the site map first, external pages at the end of the same
 * list. Both are pages as far as an editor is concerned.
 */
export const PagesPanelOpen: Story = {
  args: { ...Default.args, openPanel: "pages", selectionId: "home" },
};

/** Media galleries, by directory. */
export const MediaPanelOpen: Story = {
  args: { ...Default.args, openPanel: "media", selectionId: "home" },
};

/** Non-router val modules. */
export const DataPanelOpen: Story = {
  args: { ...Default.args, openPanel: "data", selectionId: "data-products" },
};

/** The narrow right utility panel: quick actions and recent activity. */
export const UtilityPanelOpen: Story = {
  args: { ...Default.args, openPanel: "utility", selectionId: "home" },
};

/** The assistant, floating over the editor rather than resizing it. */
export const AIChatOpen: Story = {
  args: { ...Default.args, openPanel: "ai", selectionId: "home" },
};

/** The notification centre. */
export const NotificationsOpen: Story = {
  args: { ...Default.args, openPanel: "notifications", selectionId: "home" },
};

/** Account and workspace settings — and, on mobile, the status controls. */
export const SettingsOpen: Story = {
  args: { ...Default.args, openPanel: "settings", selectionId: "home" },
};

/**
 * Global search: ⌘K / Ctrl+K from anywhere, or the top bar's search button.
 * Distinct from a panel's filter, which only narrows the list in front of you.
 */
export const GlobalSearchOpen: Story = {
  args: { ...Default.args, searchOpen: true, selectionId: "home" },
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
    selectionId: "home",
    publishState: "publishing",
  },
};

/** The publish failed. */
export const PublishFailed: Story = {
  args: { ...Default.args, selectionId: "home", publishState: "error" },
};

/** Auto save could not write to the working tree. */
export const SaveFailed: Story = {
  args: { ...Default.args, selectionId: "home", saveState: "error" },
};

/**
 * Validation errors block publishing, so the count sits next to the button it
 * blocks, and the utility panel leads with them.
 */
export const WithValidationErrors: Story = {
  args: {
    ...Default.args,
    selectionId: "data-products",
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
    selectionId: "home",
  },
};

/** A brand new project: every list empty, nothing to publish. */
export const EmptyProject: Story = {
  args: { ...Default.args, empty: true, openPanel: "pages" },
};

/**
 * Straight after Publish: the list opens itself, because the build finishes
 * somewhere Val is not. Closing it leaves the summary in the status bar, which
 * is how you get back to it.
 */
export const JustPublished: Story = {
  args: {
    ...Default.args,
    selectionId: "home",
    deployments: "mixed",
    deploymentsOpen: true,
  },
};

/** The same feed with the list closed: one line in the corner, still building. */
export const Building: Story = {
  args: { ...Default.args, selectionId: "home", deployments: "building" },
};

/**
 * A build that failed. The only red on the bar, and the only state that says
 * something the editor has to act on.
 */
export const BuildFailed: Story = {
  args: {
    ...Default.args,
    selectionId: "home",
    deployments: "failed",
    deploymentsOpen: true,
  },
};

/** Nothing published yet: the list explains what will show up here. */
export const NothingPublishedYet: Story = {
  args: {
    ...Default.args,
    selectionId: "home",
    deployments: "none",
    deploymentsOpen: true,
  },
};

/**
 * A project with no deployment feed at all. The deploy item is gone rather
 * than sitting there saying nothing.
 */
export const NoDeploymentFeed: Story = {
  args: { ...Default.args, selectionId: "home", deployments: "hidden" },
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
    selectionId: "home",
    deployments: "live",
    simulatePublish: true,
  },
};

/**
 * The default: a page opens in the module editor, exactly as before. The
 * Canvas button in the top bar is the only sign the canvas exists.
 */
export const PageWithCanvasAvailable: Story = {
  args: { ...Default.args, selectionId: "home" },
};

/**
 * Canvas added. The module editor does not go anywhere — it narrows, and the
 * page arrives beside it. Links on the page work; nothing is outlined,
 * because in this view the page is for reading, not for aiming at.
 */
export const CanvasNormalView: Story = {
  args: { ...Default.args, selectionId: "home", canvasOpen: true },
};

/**
 * The switch on the canvas: the module column is swapped for the fields Val
 * actually found on the page, and every one of them is outlined over there.
 * Clicking either side selects in both.
 */
export const CanvasFieldsView: Story = {
  args: {
    ...Default.args,
    selectionId: "home",
    canvasOpen: true,
    canvasView: "fields",
  },
};

/** The canvas with the Pages panel open over it — panels still float. */
export const CanvasWithPanelOpen: Story = {
  args: {
    ...Default.args,
    selectionId: "home",
    canvasOpen: true,
    openPanel: "pages",
  },
};

/**
 * A page Val does not track. There is no Canvas button at all, rather than
 * one that opens something empty.
 */
export const PageWithoutTrackedRoute: Story = {
  args: { ...Default.args, selectionId: "privacy" },
};

/** On a phone the two halves are panes you swipe between, canvas second. */
export const CanvasOnMobile: Story = {
  args: { ...Default.args, selectionId: "home", canvasOpen: true },
};
