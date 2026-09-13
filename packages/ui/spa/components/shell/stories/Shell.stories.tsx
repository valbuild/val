import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Shell } from "../Shell";
import { PublishState } from "../TopBar";
import { SaveState, StatusBarProps } from "../StatusBar";
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
import {
  AssistantSettingsFields,
  AssistantSettingsValue,
  SettingsTabs,
  ThemeSettingsFields,
  ThemeSettingsValue,
} from "../SettingsPanel";
import { Palette, Sparkles } from "lucide-react";
import {
  ASSISTANT_SETTINGS_MAX_LENGTH,
  THEME_RADIUS_LENGTHS,
  THEME_RADIUS_STEPS,
  ThemeRadius,
} from "@valbuild/core";
import { themeCustomProperties } from "@valbuild/shared/internal";

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
    accent: {
      control: "text",
      description: "A hex accent. Empty for Val's own green.",
    },
    radius: {
      control: "inline-radio",
      options: [...THEME_RADIUS_STEPS],
    },
    openPanel: {
      control: "select",
      options: [
        null,
        "pages",
        "media",
        "settings",
        "data",
        "account",
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
    mode: {
      control: "inline-radio",
      options: ["fs", "http"],
      description:
        "How Val is running. `fs` is the dev server (Save, Dev mode, auto save); `http` is a real project, which is the only mode with a deploy feed — so every `deployments` control below needs it.",
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
  /**
   * Nothing queued, without emptying the project.
   *
   * Its own control because "no pending changes" and "a project with nothing
   * in it" are different stories, and Review is the affordance that has to be
   * there in both — see `ReviewButton`.
   */
  noPendingChanges: boolean;
  withoutRouters: boolean;
  searchOpen: boolean;
  aiEnabled: boolean;
  theme: "dark" | "light";
  /** The project's accent, as `s.settings()`'s `theme.accent`. Empty for Val's green. */
  accent: string;
  /** The project's corner radius, as `s.settings()`'s `theme.radius`. */
  radius: ThemeRadius;
  publishState: PublishState;
  saveState: SaveState;
  mode: StatusBarProps["mode"];
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
/**
 * The settings sections, as the app supplies them.
 *
 * The real ones read source and write patches (`ValSettingsSections`), which
 * needs a running system; these hold the same values in local state. Without
 * something here the Settings panel in this story would be the empty-project
 * state, which is not what the panel normally looks like.
 */
/**
 * Both sections, with local state where the store would be.
 *
 * The Appearance tab edits its own copy rather than the story's `accent` arg,
 * so picking a colour here does NOT restyle the shell around it — in the app it
 * would, because the theme is content and the draft is what the Studio reads.
 * `Shell/SettingsPanel`'s `AppearanceThemed` story shows that half.
 */
function MockSettingsSections() {
  const [value, setValue] = useState<AssistantSettingsValue>({
    enabled: true,
    context:
      "A CMS for developers, run by a team of four in Oslo. The product is Val, never VAL.",
    tone: "Plain and direct. British English, sentence case in headings, and no exclamation marks.",
  });
  const [theme, setTheme] = useState<ThemeSettingsValue>({
    accent: null,
    radius: null,
    mode: null,
  });
  return (
    <SettingsTabs
      tabs={[
        {
          id: "assistant",
          label: "Assistant",
          icon: Sparkles,
          content: (
            <AssistantSettingsFields
              value={value}
              onChange={(field, next) =>
                setValue((current) => ({ ...current, [field]: next }))
              }
              maxLength={ASSISTANT_SETTINGS_MAX_LENGTH}
            />
          ),
        },
        {
          id: "theme",
          label: "Appearance",
          icon: Palette,
          content: (
            <ThemeSettingsFields
              value={theme}
              onChange={(field, next) =>
                setTheme((current) => ({ ...current, [field]: next }))
              }
            />
          ),
        },
      ]}
    />
  );
}

function ShellHarness({
  openPanel,
  selectionId,
  empty,
  noPendingChanges,
  withoutRouters,
  aiEnabled,
  searchOpen,
  theme,
  accent,
  radius,
  publishState,
  saveState,
  mode,
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
   * `useAutoPublish`, which needs a running system. Only visible under
   * `mode="fs"`, which is what that control defaults to: auto save is a
   * dev-server setting.
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
      renderSettings={() => <MockSettingsSections />}
      key={`${openPanel}-${selectionId}-${empty}-${noPendingChanges}-${withoutRouters}-${aiEnabled}-${searchOpen}-${isLoading}-${loadError}-${mode}-${deployments}-${deploymentsOpen}-${canvasOpen}-${canvasView}-${canvasReported}`}
      data={data}
      initialPanel={openPanel}
      initialSelectionId={selectionId}
      initialSearchOpen={searchOpen}
      aiEnabled={aiEnabled}
      theme={currentTheme}
      /*
       * What `ValThemeProvider` computes in the app. Passed as a prop so a
       * story can show the whole chrome under a project's own accent — which is
       * the only way to see all of it at once, since the accent lands on the
       * rail, the top bar, the fields and the canvas outlines.
       */
      themeStyle={themeCustomProperties({
        accent: accent || null,
        radius: THEME_RADIUS_LENGTHS[radius],
      })}
      onThemeChange={setCurrentTheme}
      pendingChanges={empty || noPendingChanges ? 0 : 12}
      /*
       * The review view, which every story has and none of them used to.
       *
       * Without `onCompare` the top bar renders no Review button at all, so
       * the one control in the bar that answers "is anything of mine still
       * unpublished?" could not be seen in Storybook - in either state.
       */
      onCompare={() => console.log("open the review view")}
      publishState={publishState}
      saveState={saveState}
      mode={mode}
      autoSave={autoSave}
      onAutoSaveChange={setAutoSave}
      isLoading={isLoading}
      loadError={loadError || undefined}
      initialDeploymentsOpen={deploymentsOpen}
      canvasPage={canvasReported ? mockCanvasPage : undefined}
      initialCanvasOpen={canvasOpen}
      initialCanvasView={canvasView}
      // Both page writes, so the Pages panel shows the New page button and the
      // per-row Duplicate control. The mock routes carry the URLs already in
      // `mockPages`, so the "already exists" state is reachable in both forms.
      onNewPage={(moduleFilePath, urlPath) =>
        console.log("New page", moduleFilePath, urlPath)
      }
      onDuplicatePage={(moduleFilePath, fromUrlPath, toUrlPath) =>
        console.log("Duplicate page", moduleFilePath, fromUrlPath, toUrlPath)
      }
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
    noPendingChanges: false,
    withoutRouters: false,
    searchOpen: false,
    aiEnabled: true,
    theme: "dark",
    accent: "",
    radius: "default",
    publishState: "idle",
    saveState: "saved",
    mode: "fs",
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

/**
 * Nothing queued, in a project that is otherwise full.
 *
 * Review is in the bar all the same. It used to be `invisible` here - in the
 * layout so the bar would not reflow, but unreachable by pointer, keyboard or
 * screen reader - which made "is anything of mine still unpublished?"
 * unanswerable from the bar: a hidden button and a button whose data has not
 * loaded are the same picture. Publish is disabled, which is the difference
 * between the two controls: one ships work, the other looks at it.
 */
export const NothingPendingToReview: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    noPendingChanges: true,
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
export const AccountOpen: Story = {
  args: {
    ...Default.args,
    openPanel: "account",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * The project's settings, behind the cog at the foot of the rail.
 *
 * The sections come from the app (`renderSettings`), and this story supplies
 * the same components with local state — see `Shell/SettingsPanel` for the
 * states they can be in.
 */
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
    mode: "http",
    deployments: "mixed",
    deploymentsOpen: true,
  },
};

/** The same feed with the list closed: one line in the corner, still building. */
export const Building: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    mode: "http",
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
    mode: "http",
    deployments: "failed",
    deploymentsOpen: true,
  },
};

/** Nothing published yet: the list explains what will show up here. */
export const NothingPublishedYet: Story = {
  args: {
    ...Default.args,
    selectionId: mockSelectionIds.home,
    mode: "http",
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
    mode: "http",
    deployments: "hidden",
  },
};

/**
 * A publish, announced on a phone.
 *
 * The bottom bar takes the row the status bar would have had, so the feed
 * comes to the phone as the list itself, above that bar, where a toast would
 * be. Set the viewport to a phone to see it. Publishing used to say nothing
 * here at all: the button went back to "Publish" and the feed was reachable
 * only through Settings, so a push that had landed and one that never went out
 * looked the same.
 */
export const DeploymentsOnMobile: Story = {
  args: {
    ...Default.args,
    mode: "http",
    deployments: "mixed",
    deploymentsOpen: true,
  },
};

/** The same feed on a phone, looked up in Account rather than announced. */
export const DeploymentsInMobileSettings: Story = {
  args: {
    ...Default.args,
    openPanel: "account",
    mode: "http",
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
    mode: "http",
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

/**
 * The whole chrome under a project's own accent.
 *
 * `s.settings()`'s `theme.accent` is one hex, and the ramp the Studio draws
 * from is generated out of it — so this is not a recoloured button but every
 * brand token at once: Publish, the active rail item, the focus rings, the
 * switch, the caret in the rich text field. The accent and the corner radius
 * are both live controls on this story.
 *
 * The Val mark does NOT follow, and that is the one deliberate exception —
 * see `architecture/logo.md`.
 */
export const ThemedStudio: Story = {
  args: {
    ...Default.args,
    accent: "#2563eb",
    radius: "tight",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * The same accent in light mode, from the same single value.
 *
 * Worth having as its own story because it is the property that makes one
 * accent enough: the semantic tokens pick different STEPS of the ramp per mode
 * (a tinted surface is step 200 in light and 800 in dark), so there is no light
 * accent and dark accent to keep in step with each other.
 */
export const ThemedStudioLight: Story = {
  args: {
    ...ThemedStudio.args,
    theme: "light",
    openPanel: "pages",
  },
};

/**
 * A project that wants the chrome to say nothing at all.
 *
 * A grey accent is a legitimate answer, and cheaper than an "off" switch of its
 * own: the ramp generator scales chroma, so a colour with none produces a ramp
 * with none. Square corners with it, since the two together are what a project
 * reaches for when it wants the tool to disappear.
 */
export const ThemedStudioQuiet: Story = {
  args: {
    ...Default.args,
    accent: "#64748b",
    radius: "square",
    selectionId: mockSelectionIds.home,
  },
};

/**
 * The accent on the customer's own page.
 *
 * The canvas outlines every editable element, and those outlines are the
 * accent: they follow it deliberately, so a project's brand colour frames the
 * project's own site. The generated step is held to 3:1 against both white and
 * black, so they stay visible whatever the site behind them looks like — see
 * `accentRamp.test.ts`.
 */
export const ThemedCanvas: Story = {
  args: {
    ...ThemedStudio.args,
    canvasOpen: true,
    canvasView: "fields",
  },
};
