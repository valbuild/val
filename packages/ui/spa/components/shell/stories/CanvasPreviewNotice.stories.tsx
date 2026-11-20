import type { Meta, StoryObj } from "@storybook/react";
import {
  CanvasPreviewNotice,
  CanvasPreviewStatus,
  PREVIEW_RECOVERY,
  type PreviewRecoveryPhase,
  type PreviewRecoveryTiming,
} from "../canvas/CanvasPreviewNotice";

/**
 * What the canvas says when it cannot do its job.
 *
 * This replaced a panel over the frame with a blurred backdrop, and the mock
 * page behind these stories is the point of them: the published page underneath
 * is real, and worth reading and scrolling, so judge this against the page
 * rather than on its own. Anything that hides more of it than the pill does is
 * the old design coming back.
 *
 * What it says is a clock, not a state -- see `PREVIEW_RECOVERY`: a spinner
 * alone for ten seconds, then what the Studio is doing about it while it turns
 * preview mode on by itself every five seconds, and after thirty seconds the
 * warning with the button. Each story below is one stretch of that clock,
 * forced rather than waited for (`phase`).
 */
const meta: Meta<typeof CanvasPane> = {
  title: "Shell/CanvasPreviewNotice",
  component: CanvasPane,
  parameters: {
    layout: "fullscreen",
    // The pane paints its own canvas colour, and the page inside it is white.
    backgrounds: { disable: true },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A page, standing in for the site the canvas is showing.
 *
 * Deliberately busy at the top, where the notice sits: a pill over an empty
 * white band proves nothing about how much it is in the way.
 */
function MockPage() {
  return (
    <div className="h-full overflow-y-auto bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-8 py-5">
        <span className="text-lg font-semibold tracking-tight">northwind</span>
        <nav className="flex gap-6 text-sm text-neutral-500">
          <span>Products</span>
          <span>Pricing</span>
          <span>Customers</span>
          <span>Docs</span>
        </nav>
      </header>
      <div className="px-8 py-16">
        <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
          Everything your warehouse already knew, finally written down
        </h1>
        <p className="mt-4 max-w-lg text-neutral-500">
          Stock, orders and deliveries in one place — and the same numbers in
          the app your drivers already use.
        </p>
        <div className="mt-8 flex gap-3">
          <span className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
            Start free
          </span>
          <span className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
            Book a demo
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The canvas pane as `PageWorkspace` builds it: the page, and the notice above
 * it in the same `relative` box.
 */
/** A clock that is already at `phase`, and makes no attempts of its own. */
function timingAt(phase: PreviewRecoveryPhase): PreviewRecoveryTiming {
  if (phase === "loading") return PREVIEW_RECOVERY;
  if (phase === "recovering") return { ...PREVIEW_RECOVERY, quietMs: 0 };
  return { ...PREVIEW_RECOVERY, quietMs: 0, retryForMs: 0 };
}

/**
 * The canvas pane as `PageWorkspace` builds it: the page, and the notice above
 * it in the same `relative` box.
 */
function CanvasPane({
  status,
  phase = "loading",
}: {
  status: CanvasPreviewStatus;
  /** Where on the clock to show it: see `timingAt`. */
  phase?: PreviewRecoveryPhase;
}) {
  return (
    <div className="h-screen bg-bg-canvas p-6">
      <div className="relative h-full overflow-hidden rounded-xl border border-border-float bg-bg-float-raised">
        <MockPage />
        <CanvasPreviewNotice
          status={status}
          timing={timingAt(phase)}
          // The stories' notice has no frame to navigate: the attempts it
          // makes on its own clock land here and change nothing.
          onEnable={() => undefined}
          onReload={() => undefined}
        />
      </div>
    </div>
  );
}

/** The first ten seconds of anything: a spinner, and no words. */
export const Loading: Story = {
  render: () => <CanvasPane status="connecting" />,
};

/**
 * Ten to thirty seconds, with the page having said preview mode is off: the
 * Studio is turning it on every five seconds, and says so. No button: it is
 * already doing what the button would.
 */
export const TurningOnByItself: Story = {
  render: () => <CanvasPane status="preview-off" phase="recovering" />,
};

/** Ten to thirty seconds, with nothing having answered yet. */
export const StillLoading: Story = {
  render: () => <CanvasPane status="connecting" phase="recovering" />,
};

/** After thirty seconds, with the page still saying preview mode is off. */
export const PreviewModeOff: Story = {
  render: () => <CanvasPane status="preview-off" phase="gave-up" />,
};

/** After thirty seconds, with nothing having answered at all. */
export const NoAnswer: Story = {
  render: () => <CanvasPane status="no-answer" phase="gave-up" />,
};

/** Working: the notice is not there at all. */
export const Live: Story = {
  render: () => <CanvasPane status="live" />,
};
