import type { Meta, StoryObj } from "@storybook/react";
import {
  CloudUpload,
  GitCompareArrows,
  Globe,
  Rocket,
  SquareDashedMousePointer,
} from "lucide-react";
import { Button } from "../../designSystem/button";
import {
  PublishHandoffCard,
  StudioPublishPage,
  type HandoffState,
  type PublishPageResult,
  type PublishStep,
} from "../PublishHandoff";
import { StatusBar } from "../StatusBar";
import type { ShellDeployment } from "../types";
import { HostPage } from "./HostPage";
import { OverlayCard, OverlayMenuButton } from "../OverlayMenu";
import { PublishSummaryView } from "../../PublishSummaryView";
import type { StudioDeployState } from "../../../publish/useStudioDeploy";

/**
 * Publishing from the overlay, which cannot build: the site commits, and a
 * Studio tab builds and reports back.
 *
 * - **Overlay** — the card over the customer's site, in each state it passes
 *   through. Under it is the overlay's own Publish, icon only as it is there,
 *   in flight for as long as the tab is working. The message is asked for as it
 *   is today; confirming it is what opens the tab.
 * - **Studio tab** — the page the overlay opened, for one commit.
 * - **Status bar** — the same progress inside the Studio itself.
 */
const meta: Meta = {
  title: "Shell/PublishHandoff",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

type Theme = "dark" | "light";

function OverlayScene({
  state,
  theme = "dark",
  prompt = false,
}: {
  state: HandoffState;
  theme?: Theme;
  /** The message prompt, as today, before anything is handed off. */
  prompt?: boolean;
}) {
  const working =
    !prompt && (state.kind === "opening" || state.kind === "running");
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: "100svh" }}
    >
      <HostPage />
      <div
        data-mode={theme}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 z-50 flex flex-col items-center gap-2"
      >
        {prompt ? (
          <OverlayCard className="w-[340px] text-sm">
            <PublishSummaryView
              value="Update the product 1 description"
              onChange={() => undefined}
              ai={{ status: "off" }}
              onUseAiSummary={() => undefined}
              onPublish={() => undefined}
              onClose={() => undefined}
              publishDisabled={false}
              isPublishing={false}
              waitingForAiSeconds={null}
            />
          </OverlayCard>
        ) : (
          <PublishHandoffCard
            state={state}
            onShowTab={() => undefined}
            onReload={() => undefined}
            onOpenStudio={() => undefined}
            onDismiss={working ? undefined : () => undefined}
          />
        )}
        {/*
         * The overlay's own Publish, as it renders there: `PublishButton
         * compact`, icon only. In flight while the tab works on the commit, the
         * same icon as any publish in flight.
         */}
        <div className="inline-flex items-center gap-1 rounded-full bg-bg-float border border-border-float shadow-lg px-2 py-1.5">
          <OverlayMenuButton
            label="Select content to edit"
            icon={<SquareDashedMousePointer size={16} />}
          />
          <OverlayMenuButton
            label="Review changes in Studio"
            icon={<GitCompareArrows size={16} />}
          />
          <Button
            className="h-8 w-8 p-0 rounded-full"
            aria-label={working ? "Publishing" : "Publish"}
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {working ? (
                <CloudUpload size={16} className="animate-pulse" />
              ) : (
                <Rocket size={16} />
              )}
            </span>
          </Button>
          <OverlayMenuButton
            label="Open Val Studio"
            icon={<Globe size={16} />}
          />
        </div>
      </div>
    </div>
  );
}

type OverlayStory = StoryObj<typeof OverlayScene>;

/**
 * Publish, pressed in the overlay: the message is asked for exactly as today.
 * Pressing Publish in here is what opens the Studio tab, in the same click, so
 * the browser lets it open.
 */
export const OverlayMessage: OverlayStory = {
  render: () => <OverlayScene prompt state={{ kind: "opening" }} />,
};

/** The moment after the message: the tab is open and the save is running. */
export const OverlayOpening: OverlayStory = {
  render: () => <OverlayScene state={{ kind: "opening" }} />,
};

/** The tab reports each step as it goes, with the time so far. */
export const OverlayBuilding: OverlayStory = {
  render: () => (
    <OverlayScene
      state={{ kind: "running", step: "Building", elapsedMs: 12_000 }}
    />
  ),
};

export const OverlayUploading: OverlayStory = {
  render: () => (
    <OverlayScene
      state={{ kind: "running", step: "Uploading 3 of 7", elapsedMs: 19_000 }}
    />
  ),
};

/** Live and served here. The page itself is still the one it loaded with. */
export const OverlayLive: OverlayStory = {
  render: () => <OverlayScene state={{ kind: "live", ms: 42_000 }} />,
};

/** The browser blocked the tab. Nothing is lost; one click finishes it. */
export const OverlayTabBlocked: OverlayStory = {
  render: () => <OverlayScene state={{ kind: "blocked" }} />,
};

export const OverlayFailed: OverlayStory = {
  render: () => (
    <OverlayScene
      state={{
        kind: "failed",
        message:
          "The build could not be uploaded. Your change is saved; open the Studio to try again.",
      }}
    />
  ),
};

export const OverlayBuildingLight: OverlayStory = {
  render: () => (
    <OverlayScene
      theme="light"
      state={{ kind: "running", step: "Building", elapsedMs: 12_000 }}
    />
  ),
};

export const OverlayLiveLight: OverlayStory = {
  render: () => (
    <OverlayScene theme="light" state={{ kind: "live", ms: 42_000 }} />
  ),
};

const STEPS = [
  "Loading the builder",
  "Reading the site",
  "Building",
  "Uploading",
  "Checking the site renders",
  "Going live",
  "Waiting for the site to show it",
];

/** The step list at a point in the publish: done up to `current`. */
function stepsAt(current: number, times: number[]): PublishStep[] {
  return STEPS.map((label, i) => ({
    label,
    status: i < current ? "done" : i === current ? "current" : "todo",
    ms: times[i],
  }));
}

function StudioTab({
  steps,
  elapsedMs,
  result,
  theme = "dark",
}: {
  steps: PublishStep[];
  elapsedMs: number;
  result?: PublishPageResult;
  theme?: Theme;
}) {
  return (
    <div data-mode={theme} style={{ height: "100svh" }}>
      <StudioPublishPage
        commit="188fa4a3c1e2d9b0"
        steps={steps}
        elapsedMs={elapsedMs}
        result={result}
        onViewSite={() => undefined}
        onOpenStudio={() => undefined}
        onClose={() => undefined}
      />
    </div>
  );
}

type TabStory = StoryObj<typeof StudioTab>;

export const StudioTabBuilding: TabStory = {
  render: () => (
    <StudioTab steps={stepsAt(2, [900, 200, 6_100])} elapsedMs={7_200} />
  ),
};

export const StudioTabGoingLive: TabStory = {
  render: () => (
    <StudioTab
      steps={stepsAt(5, [900, 200, 6_200, 3_100, 18_000, 2_400])}
      elapsedMs={30_800}
    />
  ),
};

/** Done: every step with its time, and the tab closes itself. */
export const StudioTabLive: TabStory = {
  render: () => (
    <StudioTab
      steps={stepsAt(7, [900, 200, 6_200, 3_100, 18_000, 2_400, 11_200])}
      elapsedMs={42_000}
      result={{ kind: "live", ms: 42_000, closingInS: 5 }}
    />
  ),
};

export const StudioTabFailed: TabStory = {
  render: () => (
    <StudioTab
      steps={[
        ...stepsAt(3, [900, 200, 6_200]).slice(0, 3),
        { label: "Uploading", status: "failed", ms: 2_100 },
        ...STEPS.slice(4).map(
          (label): PublishStep => ({ label, status: "todo" }),
        ),
      ]}
      elapsedMs={9_400}
      result={{
        kind: "failed",
        message:
          "The build could not be uploaded (content answered 502). Your change is saved.",
      }}
    />
  ),
};

export const StudioTabLiveLight: TabStory = {
  render: () => (
    <StudioTab
      theme="light"
      steps={stepsAt(7, [900, 200, 6_200, 3_100, 18_000, 2_400, 11_200])}
      elapsedMs={42_000}
      result={{ kind: "live", ms: 42_000, closingInS: 5 }}
    />
  ),
};

/**
 * The status bar inside the Studio: "All changes saved", the publish while it
 * runs ("Publishing 42%" and a bar, gone when it is done), and the deploy
 * summary, which says "Live" once it is. The list behind the summary has the
 * breakdown of this tab's own publish.
 */
function StudioStatusBar({
  deployState,
  deployments,
  open = false,
  theme = "dark",
}: {
  deployState: StudioDeployState;
  deployments: ShellDeployment[];
  open?: boolean;
  theme?: Theme;
}) {
  return (
    <div
      data-mode={theme}
      className="relative bg-bg-primary"
      style={{ height: "100svh" }}
    >
      <StatusBar
        breakpoint="desktop"
        saveState="saved"
        mode="http"
        autoSave={false}
        onAutoSaveChange={() => undefined}
        branch="main"
        deployments={deployments}
        studioIsDeployer
        onFinishPublishing={() => undefined}
        deployState={deployState}
        deploymentsOpen={open}
        onDeploymentsOpenChange={() => undefined}
      />
    </div>
  );
}

const earlier: ShellDeployment = {
  commitSha: "a1b2c3d4e5f6",
  state: "success",
  message: "Update the opening hours",
  author: "Fredrik",
  timestamp: "2 hours ago",
  updatedAt: "2026-09-24T12:00:00Z",
  isLive: false,
};

const running = (percent: number, step: string): ShellDeployment => ({
  commitSha: "188fa4a3c1e2",
  state: "created",
  message: "Update the product 1 description",
  author: "Fredrik",
  timestamp: "just now",
  updatedAt: "2026-09-24T15:00:00Z",
  isLive: false,
  publish: { kind: "running", percent, step },
});

const live: ShellDeployment = {
  commitSha: "188fa4a3c1e2",
  state: "created",
  message: "Update the product 1 description",
  author: "Fredrik",
  timestamp: "just now",
  updatedAt: "2026-09-24T15:00:00Z",
  isLive: true,
  publish: {
    kind: "done",
    ms: 29_000,
    steps: [
      { label: "Loading the builder", ms: 900 },
      { label: "Reading the site", ms: 300 },
      { label: "Building", ms: 6_200 },
      { label: "Uploading", ms: 2_100 },
      { label: "Checking the site renders", ms: 11_800 },
      { label: "Going live", ms: 1_900 },
      { label: "Waiting for the site to show it", ms: 5_800 },
    ],
  },
};

const runningState = (
  phase: StudioDeployState extends infer S
    ? S extends { status: "running"; phase: infer P }
      ? P
      : never
    : never,
): StudioDeployState => ({
  status: "running",
  phase,
  startedAt: Date.now() - 12_000,
  phaseStartedAt: Date.now() - 4_000,
  commit: null,
});

type BarStory = StoryObj<typeof StudioStatusBar>;

/** Publishing: the percentage and a bar, beside the summary. */
export const StatusBarPublishing: BarStory = {
  render: () => (
    <StudioStatusBar
      deployState={runningState({ kind: "building" })}
      deployments={[running(12, "Building"), earlier]}
    />
  ),
};

export const StatusBarUploading: BarStory = {
  render: () => (
    <StudioStatusBar
      deployState={runningState({ kind: "uploading", done: 2, total: 5 })}
      deployments={[running(50, "Uploading 2 of 5"), earlier]}
    />
  ),
};

/** Done: the percentage is gone, and the summary says Live. */
export const StatusBarLive: BarStory = {
  render: () => (
    <StudioStatusBar
      deployState={{
        status: "done",
        result: { status: "live", url: null, visible: true },
        ms: 29_000,
        steps: [],
        commit: "188fa4a3c1e2",
      }}
      deployments={[live, earlier]}
    />
  ),
};

/** The list, while it runs: the row has the step and the percentage. */
export const StatusBarListPublishing: BarStory = {
  render: () => (
    <StudioStatusBar
      open
      deployState={runningState({ kind: "verifying" })}
      deployments={[running(64, "Checking the site renders"), earlier]}
    />
  ),
};

/** The list, once it is live: how long it took, and each step's time. */
export const StatusBarListLive: BarStory = {
  render: () => (
    <StudioStatusBar
      open
      deployState={{
        status: "done",
        result: { status: "live", url: null, visible: true },
        ms: 29_000,
        steps: [],
        commit: "188fa4a3c1e2",
      }}
      deployments={[live, earlier]}
    />
  ),
};

export const StatusBarListLiveLight: BarStory = {
  render: () => (
    <StudioStatusBar
      open
      theme="light"
      deployState={{
        status: "done",
        result: { status: "live", url: null, visible: true },
        ms: 29_000,
        steps: [],
        commit: "188fa4a3c1e2",
      }}
      deployments={[live, earlier]}
    />
  ),
};
