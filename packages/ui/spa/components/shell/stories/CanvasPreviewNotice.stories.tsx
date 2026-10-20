import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  CanvasPreviewNotice,
  CanvasPreviewStatus,
  previewNeedsTurningOn,
} from "../canvas/CanvasPreviewNotice";
import { CanvasToolbar } from "../canvas/CanvasToolbar";
import { CanvasDevice } from "../canvas/types";

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
 * Content all the way down to the bottom, where the notice sits: a pill over
 * an empty white band proves nothing about how much it is in the way.
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
        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {["Stock", "Orders", "Deliveries"].map((title) => (
            <div
              key={title}
              className="rounded-lg border border-neutral-200 p-5"
            >
              <h2 className="font-medium">{title}</h2>
              <p className="mt-2 text-sm text-neutral-500">
                Counted where it happens, and the same number everywhere you
                look.
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The canvas pane as `PageWorkspace` builds it: the page, the notice over the
 * bottom of it in the same `relative` box, and the toolbar under that — so the
 * notice can be judged against the pick button it sits above.
 */
function CanvasPane({
  status,
  warning,
  width,
}: {
  status: CanvasPreviewStatus;
  /** The pane's width, for the phone; the whole story otherwise. */
  width?: number;
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
  const [device, setDevice] = useState<CanvasDevice>("desktop");
  const [isPicking, setIsPicking] = useState(false);
  return (
    <div
      className="flex h-screen flex-col gap-2 bg-bg-canvas p-6"
      style={width ? { width, padding: 12 } : undefined}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-float bg-bg-float-raised">
        <MockPage />
        <CanvasPreviewNotice
          status={status}
          warnAfterMs={warning ? 0 : undefined}
          onEnable={() => console.log("enable preview mode")}
          onReload={() => console.log("reload")}
        />
      </div>
      <div className="flex shrink-0 justify-center">
        <CanvasToolbar
          className="max-w-full"
          device={device}
          onDeviceChange={setDevice}
          scale={1}
          onZoomIn={() => undefined}
          onZoomOut={() => undefined}
          onFit={() => undefined}
          isPicking={isPicking}
          onPickingChange={setIsPicking}
          pickNeedsPreview={previewNeedsTurningOn(status)}
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

/**
 * Preview mode off, on a phone: the pill wraps, and the toolbar is scrolled so
 * the outlined pick button under it is in view.
 */
export const PreviewModeOffOnAPhone: Story = {
  render: () => <CanvasPane status="preview-off" warning width={366} />,
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
