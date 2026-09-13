import type { Meta, StoryObj } from "@storybook/react";
import {
  CanvasPreviewNotice,
  CanvasPreviewStatus,
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
 * The severity is a clock, not a state — see `PREVIEW_WARNING_DELAY_MS` — so
 * each story below is one END of it. The stories force it rather than waiting
 * twenty seconds, which is what `warning` does.
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
function CanvasPane({
  status,
  warning,
}: {
  status: CanvasPreviewStatus;
  /**
   * Skip the wait, so the warning end of the clock is reachable in a story.
   *
   * The clock runs from when the attempt began and re-mounting only restarts
   * it, so the delay is a prop with a default rather than something a story
   * can wait out - twenty seconds is longer than anyone reviewing a design
   * will sit still for.
   */
  warning?: boolean;
}) {
  return (
    <div className="h-screen bg-bg-canvas p-6">
      <div className="relative h-full overflow-hidden rounded-xl border border-border-float bg-bg-float-raised">
        <MockPage />
        <CanvasPreviewNotice
          status={status}
          warnAfterMs={warning ? 0 : undefined}
          onEnable={() => console.log("enable preview mode")}
          onReload={() => console.log("reload")}
        />
      </div>
    </div>
  );
}

/** The first twenty seconds of anything: a spinner, and no accusation. */
export const NotReadyYet: Story = {
  render: () => <CanvasPane status="preview-off" />,
};

/** Past the wait, with the page having answered that draft mode is off. */
export const PreviewModeOff: Story = {
  render: () => <CanvasPane status="preview-off" warning />,
};

/** Past the wait, with nothing having answered at all. */
export const NoAnswer: Story = {
  render: () => <CanvasPane status="no-answer" warning />,
};

/** Between the click and the new document arriving. */
export const TurningOn: Story = {
  render: () => <CanvasPane status="enabling" />,
};

/** Working: the notice is not there at all. */
export const Live: Story = {
  render: () => <CanvasPane status="live" />,
};
