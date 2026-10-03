import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Toaster, toast } from "../../designSystem/sonner";
import {
  PublishHandoffCard,
  StudioPublishPage,
  type PublishPageResult,
  type PublishStep,
} from "../PublishHandoff";
import { StatusBar } from "../StatusBar";
import type { ShellDeployment } from "../types";
import {
  EDGE_CACHE_MS,
  type PublishIndicator,
} from "../../../publish/publishIndicatorView";

/**
 * The status bar's one publish indicator, in every state a publish passes
 * through -- in Chrome, where the Studio builds the site in the tab, and in
 * Safari, where a builder tab does and reports back.
 *
 * It spins until every visitor gets the change, about a minute after "Live",
 * once each edge's cache of the site's pointer has run out: Publishing N%,
 * then Reaching visitors N%, then Live. The step is behind it, on hover. It
 * spins for anyone's publish, not only this editor's. The list opens on a
 * click and never by itself, and the "Published" toast comes when it stops.
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

const showPublished = () =>
  toast("Published", {
    id: "story-published",
    description: "Every visitor now sees your changes.",
    duration: Infinity,
  });

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

const mine = (step: string, percent: number | null): PublishIndicator => ({
  kind: "publishing",
  mine: true,
  step,
  percent,
});

/** Live `secondsAgo` ago: rendered fresh, so the bar reads the same each time. */
const reaching = (isMine: boolean, secondsAgo = 30): PublishIndicator => ({
  kind: "reaching",
  mine: isMine,
  everywhereAt: Date.now() + EDGE_CACHE_MS - secondsAgo * 1000,
});

type SceneStory = StoryObj<typeof Scene>;

// ---------------------------------------------------------------------------
// Chrome: the Studio builds the site in the tab.
// ---------------------------------------------------------------------------

/** At rest: every visitor sees the latest published changes. */
export const Live: SceneStory = {
  render: () => <Scene indicator={{ kind: "live" }} />,
};

/** Pressed: the tab is building. Hover: "Building". */
export const ChromeBuilding: SceneStory = {
  render: () => <Scene indicator={mine("Building", 12)} />,
};

/** Uploading what it built. Hover: "Uploading 3 of 7". */
export const ChromeUploading: SceneStory = {
  render: () => <Scene indicator={mine("Uploading 3 of 7", 52)} />,
};

/**
 * Handed to content, which checks the site renders and seals it. Hover:
 * "Checking the site renders".
 */
export const ChromeChecking: SceneStory = {
  render: () => <Scene indicator={mine("Checking the site renders", 64)} />,
};

/**
 * Live, and the edges are catching up: the bar keeps filling with the clock.
 * Hover: "Live. Every visitor sees your changes within 30s."
 */
export const ChromeReachingVisitors: SceneStory = {
  render: () => <Scene indicator={reaching(true)} />,
};

/** Every visitor has it: the spinner stops, and the one toast. */
export const ChromeLiveEverywhere: SceneStory = {
  render: () => (
    <Scene indicator={{ kind: "live" }}>
      <ToastOnMount show={showPublished} />
    </Scene>
  ),
};

/** The list, opened by a click: the publish, and each step's time. */
export const ListOpen: SceneStory = {
  render: () => <Scene open indicator={{ kind: "live" }} />,
};

/** Failed: red until something newer goes live; the toast has the actions. */
export const Failed: SceneStory = {
  render: () => (
    <Scene indicator={{ kind: "failed", cause: "publish" }}>
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

// ---------------------------------------------------------------------------
// Someone else's publish, and CI's.
// ---------------------------------------------------------------------------

/**
 * Another editor pressed Publish. Nothing reports how far their build is, so
 * the bar pulses rather than counting. Hover: "Another editor's changes are
 * being published."
 */
export const AnotherEditorPublishing: SceneStory = {
  render: () => (
    <Scene
      indicator={{ kind: "publishing", mine: false, step: null, percent: null }}
    />
  ),
};

/** Their publish is live, and the edges are catching up: a real bar again. */
export const AnotherEditorReachingVisitors: SceneStory = {
  render: () => <Scene indicator={reaching(false)} />,
};

/** Connected: content pushed the commit, and CI is building it. */
export const ConnectedBuilding: SceneStory = {
  render: () => (
    <Scene
      studioIsDeployer={false}
      deployments={[pushed, earlier]}
      indicator={{ kind: "building", count: 1 }}
    />
  ),
};

export const ReachingVisitorsLight: SceneStory = {
  render: () => <Scene theme="light" indicator={reaching(true)} />,
};

// ---------------------------------------------------------------------------
// Safari: the Studio cannot build, so it opens a builder tab that does.
// ---------------------------------------------------------------------------

/** A job's steps in the builder tab: they end at the upload. */
const JOB_STEPS = [
  "Starting the publish",
  "Loading the builder",
  "Reading the site",
  "Building",
  "Preparing the upload",
  "Uploading",
  "Checking the upload",
];
const JOB_TIMES = [1_100, 900, 300, 6_200, 400, 2_100, 600];

function jobStepsAt(current: number, currentLabel?: string): PublishStep[] {
  return JOB_STEPS.map((label, i) => ({
    label: i === current && currentLabel ? currentLabel : label,
    status: i < current ? "done" : i === current ? "current" : "todo",
    ms: i <= current ? JOB_TIMES[i] : undefined,
  }));
}

/**
 * The builder window Safari opens: a small popup over the Studio, the size
 * `openBuilderWindow` asks for, drawn with a window's title bar so it reads
 * as the separate window it is.
 */
function BuilderWindow({
  steps,
  elapsedMs,
  result,
}: {
  steps: PublishStep[];
  elapsedMs: number;
  result?: PublishPageResult;
}) {
  return (
    <div
      className="absolute left-16 top-6 w-[420px] overflow-hidden rounded-lg border border-border-float shadow-2xl"
      style={{ height: 520 }}
    >
      <div className="flex h-7 items-center gap-1.5 bg-bg-secondary px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 truncate text-[11px] text-fg-secondary-alt">
          example.com/val?publish-handoff=…
        </span>
      </div>
      <div className="h-[calc(100%-1.75rem)] overflow-hidden">
        <StudioPublishPage
          jobId="j_7c41e09a"
          steps={steps}
          elapsedMs={elapsedMs}
          result={result}
          onOpenStudio={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </div>
  );
}

/**
 * Pressed. Safari opens the builder window from the click; the Studio's
 * indicator starts at 0% and follows the window from here.
 */
export const SafariPressed: SceneStory = {
  render: () => (
    <Scene indicator={mine("Starting the publish", 0)}>
      <BuilderWindow steps={jobStepsAt(0)} elapsedMs={1_000} />
    </Scene>
  ),
};

/** The window builds; its step and percentage come back to the Studio. */
export const SafariBuilding: SceneStory = {
  render: () => (
    <Scene indicator={mine("Building", 12)}>
      <BuilderWindow steps={jobStepsAt(3)} elapsedMs={9_000} />
    </Scene>
  ),
};

export const SafariUploading: SceneStory = {
  render: () => (
    <Scene indicator={mine("Uploading 3 of 7", 52)}>
      <BuilderWindow
        steps={jobStepsAt(5, "Uploading 3 of 7")}
        elapsedMs={12_000}
      />
    </Scene>
  ),
};

/**
 * The window handed its build to content and closes itself in 5 s. The
 * Studio carries on: content checks the site renders.
 */
export const SafariHandedOver: SceneStory = {
  render: () => (
    <Scene indicator={mine("Checking the site renders", 64)}>
      <BuilderWindow
        steps={jobStepsAt(7)}
        elapsedMs={13_000}
        result={{ kind: "handed-off", closingInS: 5 }}
      />
    </Scene>
  ),
};

/** The window has closed. Live, and the edges are catching up. */
export const SafariReachingVisitors: SceneStory = {
  render: () => <Scene indicator={reaching(true)} />,
};

/** Every visitor has it: the same ending as Chrome. */
export const SafariLiveEverywhere: SceneStory = {
  render: () => (
    <Scene indicator={{ kind: "live" }}>
      <ToastOnMount show={showPublished} />
    </Scene>
  ),
};

/**
 * Safari blocked the window. The one card the Studio still shows: it needs a
 * click, and the publish waits for it at 0%.
 */
export const SafariBlocked: SceneStory = {
  render: () => (
    <Scene indicator={mine("Starting the publish", 0)}>
      <div className="absolute right-4 bottom-[3.75rem]">
        <PublishHandoffCard
          state={{ kind: "blocked" }}
          onOpenStudio={() => undefined}
          onDismiss={() => undefined}
        />
      </div>
    </Scene>
  ),
};
