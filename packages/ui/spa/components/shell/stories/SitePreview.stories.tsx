import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { SitePreview } from "../canvas/SitePreview";
import { CanvasPage } from "../canvas/CanvasPage";
import { mockCanvasPage } from "../canvas/mockCanvasPage";

/**
 * The site, as the Studio previews it: one component for the content
 * editor's canvas and the Sketchpad's preview, so both have the same address
 * bar and the same toolbar -- device widths, zoom, fit, Select and reload.
 *
 * In the app the page is the running site in a `CanvasFrame`; here it is the
 * demo page. What differs between the places it is used is passed in: what
 * closes it, whether a pick means anything.
 */
const meta: Meta<typeof Demo> = {
  title: "Shell/SitePreview",
  component: Demo,
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const ROUTES = ["/", "/about", "/journal", "/stores"];

function Demo({
  width,
  pickable = false,
}: {
  /** The pane's width; the whole window when absent. */
  width?: number;
  /** Whether a click on the page can select a field, as on the canvas. */
  pickable?: boolean;
}) {
  const [route, setRoute] = useState("/");
  const [isPicking, setIsPicking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="flex h-screen bg-bg-canvas p-3">
      <div
        style={{ width }}
        className={width ? "h-full shrink-0" : "h-full min-w-0 flex-1"}
      >
        <SitePreview
          route={route}
          onRouteChange={setRoute}
          routes={ROUTES}
          isPicking={isPicking}
          onPickingChange={pickable ? setIsPicking : undefined}
          reloadable={false}
          onPageClick={() => setSelected(null)}
          renderPage={({ device }) => (
            <CanvasPage
              page={mockCanvasPage}
              device={device}
              selectedFieldId={isPicking ? selected : null}
              attachedFieldIds={[]}
              onSelectField={setSelected}
              isSelectMode={isPicking}
            />
          )}
        />
      </div>
    </div>
  );
}

/** As on the canvas beside the content editor: with Select. */
export const OnTheCanvas: Story = {
  args: { pickable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Select on the page" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Stop selecting on the page" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

/**
 * As beside the Sketchpad: a pane about as wide as the Sketchpad's, and no
 * Select, since a pick there has no editor to open a field in. The toolbar
 * is the canvas's own.
 */
export const BesideTheSketchpad: Story = {
  args: { width: 460 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "mobile width" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "mobile width" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.queryByRole("button", { name: "Select on the page" }),
    ).toBeNull();
  },
};
