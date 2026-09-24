import type { Meta, StoryObj } from "@storybook/react";
import { Loader2, Upload } from "lucide-react";
import {
  PublishHandoffCard,
  StudioPublishPage,
  type HandoffState,
  type PublishPageResult,
  type PublishStep,
} from "../PublishHandoff";
import { DeployProgress } from "../DeployProgress";
import { HostPage } from "./HostPage";
import { cn } from "../../designSystem/cn";
import type { StudioDeployState } from "../../../publish/useStudioDeploy";

/**
 * Publishing from the overlay, which cannot build: the site commits, and a
 * Studio tab builds and reports back.
 *
 * - **Overlay** — the card over the customer's site, in each state it passes
 *   through. The bar under it is the overlay's own, reduced to its Publish
 *   button, which says "Publishing…" for as long as the tab is working.
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
}: {
  state: HandoffState;
  theme?: Theme;
}) {
  const working = state.kind === "opening" || state.kind === "running";
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
        <PublishHandoffCard
          state={state}
          onShowTab={() => undefined}
          onReload={() => undefined}
          onOpenStudio={() => undefined}
          onDismiss={working ? undefined : () => undefined}
        />
        <div className="inline-flex items-center gap-1 rounded-full bg-bg-float border border-border-float shadow-lg px-2 py-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary",
            )}
          >
            {working ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {working ? "Publishing…" : "Publish"}
          </span>
        </div>
      </div>
    </div>
  );
}

type OverlayStory = StoryObj<typeof OverlayScene>;

/** The moment after Publish: the commit is saved and the tab is opening. */
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

/** The status bar line inside the Studio, for a publish made there. */
function StatusBarLine({
  state,
  theme = "dark",
}: {
  state: StudioDeployState;
  theme?: Theme;
}) {
  return (
    <div
      data-mode={theme}
      className="p-6 bg-bg-primary"
      style={{ height: "100svh" }}
    >
      <footer className="h-9 flex items-center gap-3 px-3 rounded-lg bg-bg-float border border-border-float shadow-sm text-xs text-fg-secondary max-w-2xl">
        <span className="font-mono">main</span>
        <div className="ml-auto flex items-center gap-3">
          <DeployProgress state={state} />
          <span>3 deployments</span>
        </div>
      </footer>
    </div>
  );
}

type BarStory = StoryObj<typeof StatusBarLine>;

export const StatusBarBuilding: BarStory = {
  render: () => (
    <StatusBarLine
      state={{
        status: "running",
        phase: { kind: "building" },
        startedAt: Date.now() - 12_000,
        phaseStartedAt: Date.now() - 6_000,
      }}
    />
  ),
};

export const StatusBarWaitingForSite: BarStory = {
  render: () => (
    <StatusBarLine
      state={{
        status: "running",
        phase: { kind: "propagating" },
        startedAt: Date.now() - 38_000,
        phaseStartedAt: Date.now() - 4_000,
      }}
    />
  ),
};

export const StatusBarLive: BarStory = {
  render: () => (
    <StatusBarLine
      state={{
        status: "done",
        result: { status: "live", url: null, visible: true },
        ms: 42_000,
        steps: [],
      }}
    />
  ),
};

export const StatusBarLiveNotYetHere: BarStory = {
  render: () => (
    <StatusBarLine
      state={{
        status: "done",
        result: { status: "live", url: null, visible: false },
        ms: 124_000,
        steps: [],
      }}
    />
  ),
};
