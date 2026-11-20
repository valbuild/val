import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { SitePreview } from "../canvas/SitePreview";
import { CanvasPage } from "../canvas/CanvasPage";
import { mockCanvasPage } from "../canvas/mockCanvasPage";

/**
 * The site, as the Studio previews it: one component for the content
 * editor's canvas and the Sketchpad's preview, so both have the same address
 * bar and the same toolbar -- device widths, zoom, fit and reload.
 *
 * In the app the page is the running site in a `CanvasFrame`; here it is the
 * demo page. What differs between the places it is used is passed in: what
 * closes it, and whether a click on the page picks a field.
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
  picking = false,
}: {
  /** The pane's width; the whole window when absent. */
  width?: number;
  /**
   * Whether a click on the page picks a field. Switched by the Select in the
   * pane the pick is for, never by the preview itself.
   */
  picking?: boolean;
}) {
  const [route, setRoute] = useState("/");
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
          isPicking={picking}
          reloadable={false}
          onPageClick={() => setSelected(null)}
          renderPage={({ device }) => (
            <CanvasPage
              page={mockCanvasPage}
              device={device}
              selectedFieldId={picking ? selected : null}
              attachedFieldIds={[]}
              onSelectField={setSelected}
              isSelectMode={picking}
            />
          )}
        />
      </div>
    </div>
  );
}

/**
 * As on the canvas beside the content editor, with Content's Select on: the
 * fields it can open are outlined. The Select itself is in Content's header,
 * not here: the preview has none of its own.
 */
export const OnTheCanvas: Story = {
  args: { picking: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Fit page width" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /Select on the page/ }),
    ).toBeNull();
  },
};

/**
 * In a narrow pane, as when the content column or the Sketchpad takes most
 * of the window. The toolbar is the same one.
 */
export const NarrowPane: Story = {
  args: { width: 460 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "mobile width" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "mobile width" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};
