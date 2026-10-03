import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Toaster, toast } from "../../designSystem/sonner";
import { PublishHandoffCard, type HandoffState } from "../PublishHandoff";
import { StatusBar } from "../StatusBar";
import type { ShellDeployment } from "../types";
import type { PublishIndicator } from "../../../publish/publishIndicatorView";
import { EDGE_CACHE_MS } from "../../../publish/publishIndicator";

/**
 * The status bar's one publish indicator, in every state a publish passes
 * through.
 *
 * It spins until every visitor gets the change -- which is about a minute
 * after "Live", once each edge's cache of the site's pointer has run out -- and
 * says so in one of three words: Publishing, Reaching visitors, Live. The step
 * and the percentage are behind it, on hover. It spins for anyone's publish,
 * not only this editor's. The list opens on a click and never by itself, and
 * the "Published" toast comes when it stops spinning.
 */
const meta: Meta = {
  title: "Shell/PublishIndicator",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

type Theme = "dark" | "light";

/** A Studio's floor: the status bar, and whatever sits above it. */
function Scene({
  indicator,
  deployments = [published, earlier],
  open = false,
  theme = "dark",
  studioIsDeployer = true,
  children,
}: {
  indicator: PublishIndicator;
  deployments?: ShellDeployment[];
  open?: boolean;
  theme?: Theme;
  studioIsDeployer?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-mode={theme}
      className="relative bg-bg-primary"
      style={{ height: "100svh" }}
    >
      {children}
      <StatusBar
        breakpoint="desktop"
        saveState="saved"
        mode="http"
        autoSave={false}
        onAutoSaveChange={() => undefined}
        deployments={deployments}
        studioIsDeployer={studioIsDeployer}
        publishIndicator={indicator}
        deploymentsOpen={open}
        onDeploymentsOpenChange={() => undefined}
      />
    </div>
  );
}

/** A toast, as the Studio's own Toaster shows it, held on screen. */
function ToastOnMount({ show }: { show: () => void }) {
  useEffect(() => {
    show();
    return () => {
      toast.dismiss();
    };
  }, [show]);
  return <Toaster />;
}

const earlier: ShellDeployment = {
  commitSha: "a1b2c3d4e5f6",
  state: "success",
  message: "Update the opening hours",
  author: "Theo",
  timestamp: "2 hours ago",
  updatedAt: "2026-10-03T08:00:00Z",
  isLive: false,
};

const published: ShellDeployment = {
  commitSha: "188fa4a3c1e2",
  state: "success",
  message: "Update the product 1 description",
  author: "Fredrik",
  timestamp: "just now",
  updatedAt: "2026-10-03T10:00:00Z",
  isLive: true,
  publish: {
    kind: "done",
    ms: 41_000,
    steps: [
      { label: "Loading the builder", ms: 900 },
      { label: "Reading the site", ms: 300 },
      { label: "Building", ms: 6_200 },
      { label: "Preparing the upload", ms: 400 },
      { label: "Uploading", ms: 2_100 },
      { label: "Checking the upload", ms: 600 },
      { label: "Checking the site renders", ms: 11_800 },
    ],
  },
};

const pushed: ShellDeployment = {
  commitSha: "77e0c1d2b3a4",
  state: "pending",
  message: "Update the product 1 description",
  author: "Fredrik",
  timestamp: "just now",
  updatedAt: "2026-10-03T10:00:00Z",
  isLive: false,
};

const reaching = (mine: boolean): PublishIndicator => ({
  kind: "reaching",
  mine,
  // Rendered fresh, so the countdown reads ~40s whenever it is looked at.
  everywhereAt: Date.now() + EDGE_CACHE_MS - 20_000,
});

type SceneStory = StoryObj<typeof Scene>;

/**
 * At rest: nothing is on its way, and every visitor sees the latest published
 * changes. Hover: "Every visitor sees the latest published changes."
 */
export const Live: SceneStory = {
  render: () => <Scene indicator={{ kind: "live" }} />,
};

/**
 * This editor pressed Publish and this tab is building it. One word, a
 * spinner; the step and the percentage on hover: "Building · 12%".
 */
export const PublishingHere: SceneStory = {
  render: () => (
    <Scene
      indicator={{
        kind: "publishing",
        mine: true,
        step: "Building",
        percent: 12,
      }}
    />
  ),
};

/** The same, later in the build: "Uploading 3 of 7 · 52%". */
export const PublishingUploading: SceneStory = {
  render: () => (
    <Scene
      indicator={{
        kind: "publishing",
        mine: true,
        step: "Uploading 3 of 7",
        percent: 52,
      }}
    />
  ),
};

/**
 * Safari: a builder tab builds it, and this page shows that tab's step, with
 * no percentage, since none is reported back. No card: the card is for a tab
 * that was blocked or failed.
 */
export const PublishingInBuilderTab: SceneStory = {
  render: () => (
    <Scene
      indicator={{
        kind: "publishing",
        mine: true,
        step: "Uploading 3 of 7",
        percent: null,
      }}
    />
  ),
};

/**
 * Another editor pressed Publish. Every Studio on the branch hears the job on
 * content's websocket, so it spins here too. Hover: "Another editor's changes
 * are being published."
 */
export const PublishingByAnotherEditor: SceneStory = {
  render: () => (
    <Scene
      indicator={{
        kind: "publishing",
        mine: false,
        step: null,
        percent: null,
      }}
    />
  ),
};

/**
 * Live, and not yet at every edge: the site's pointer has moved, and each
 * Cloudflare location may serve the old build for up to a minute. Still
 * spinning, so "stopped" keeps meaning "every visitor sees it". Hover: "Live.
 * Every visitor sees your changes within 40s."
 */
export const ReachingVisitors: SceneStory = {
  render: () => <Scene indicator={reaching(true)} />,
};

/** Another editor's publish, at the same stage: "…sees the changes within 40s." */
export const ReachingVisitorsAnotherEditor: SceneStory = {
  render: () => <Scene indicator={reaching(false)} />,
};

export const ReachingVisitorsLight: SceneStory = {
  render: () => <Scene theme="light" indicator={reaching(true)} />,
};

/**
 * The end of the window: the spinner stops, and the editor who published gets
 * the one announcement -- a toast. Other editors get no toast: the indicator
 * stopping is theirs.
 */
export const LiveEverywhereToast: SceneStory = {
  render: () => (
    <Scene indicator={{ kind: "live" }}>
      <ToastOnMount
        show={() =>
          toast("Published", {
            id: "story-published",
            description: "Every visitor now sees your changes.",
            duration: Infinity,
          })
        }
      />
    </Scene>
  ),
};

/**
 * The list, opened by a click: the publish that went live, how long it took,
 * and each step. It never opens by itself any more.
 */
export const ListOpen: SceneStory = {
  render: () => <Scene open indicator={{ kind: "live" }} />,
};

/**
 * This editor's publish failed. The indicator turns red and stays so until
 * something newer goes live; the toast is where Try again and Discard are,
 * and it stays until it is answered.
 */
export const Failed: SceneStory = {
  render: () => (
    <Scene indicator={{ kind: "failed" }}>
      <ToastOnMount
        show={() =>
          toast.error("Could not publish", {
            id: "story-failed",
            description: "The site could not be built from this change.",
            duration: Infinity,
            action: { label: "Try again", onClick: () => undefined },
            cancel: { label: "Discard changes", onClick: () => undefined },
          })
        }
      />
    </Scene>
  ),
};

/**
 * Safari, and the browser blocked the builder tab. The one case the card
 * still appears in the Studio: something needs a click. The publish is
 * waiting for that tab, so the indicator spins.
 */
export const BuilderTabBlocked: SceneStory = {
  render: () => {
    const state: HandoffState = { kind: "blocked" };
    return (
      <Scene
        indicator={{
          kind: "publishing",
          mine: true,
          step: "Loading the builder",
          percent: 0,
        }}
      >
        <div className="absolute right-4 bottom-[3.75rem]">
          <PublishHandoffCard
            state={state}
            onOpenStudio={() => undefined}
            onDismiss={() => undefined}
          />
        </div>
      </Scene>
    );
  },
};

/**
 * A connected project: content pushed the commit and CI is building it. The
 * same spinner, the feed's word for it; it becomes "Reaching visitors" when
 * CI's build goes live.
 */
export const ConnectedBuilding: SceneStory = {
  render: () => (
    <Scene
      studioIsDeployer={false}
      deployments={[pushed, earlier]}
      indicator={{ kind: "building", count: 1 }}
    />
  ),
};
