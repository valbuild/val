import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { AIChat } from "../../AIChat";
import { Shell } from "../../shell/Shell";
import { mockSelectionIds, mockShellData } from "../../shell/mockShellData";
import { Sketchpad, type SketchpadAssistantStatus } from "../Sketchpad";
import { SketchpadWorkspace } from "../SketchpadWorkspace";
import { SKETCH } from "./sketchpadFixtures";
import { mockCanvasPage } from "../../shell/canvas/mockCanvasPage";

/**
 * The Sketchpad on a phone: one of the workspace's panes, switched from the
 * pane bar at the bottom (Content | Preview | Sketch | Assistant), like the
 * editor. The page it is about is in the Preview pane -- the Studio's one
 * preview -- and "Show it in the preview" on a route divider goes there.
 *
 * The tools are at the bottom of the sketch, where the thumb is, and box
 * buttons (add an image, remove it) are always shown on a touch screen,
 * which has no hover to show them on.
 */
const meta: Meta<typeof PhoneSketchpad> = {
  title: "Components/Sketchpad/On a phone",
  component: PhoneSketchpad,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  globals: { theme: "light", viewport: { value: "mobile2", isRotated: false } },
};
export default meta;
type Story = StoryObj<typeof PhoneSketchpad>;

const ADDED_QUOTE = "  [testimonial: Mari, wears the coat her mother bought]";

function PhoneSketchpad() {
  const [value, setValue] = useState(SKETCH);
  const [read, setRead] = useState(SKETCH);
  const [reading, setReading] = useState(false);
  const [route, setRoute] = useState("/");

  const status: SketchpadAssistantStatus = reading
    ? "reading"
    : value === read
      ? "read"
      : "changed";

  // The assistant reads it, and adds a third quote, as in the desktop story.
  const sendToAssistant = () => {
    setReading(true);
    setTimeout(() => {
      const written = value.includes(ADDED_QUOTE)
        ? value
        : value.replace(
            /( {2}\[testimonial: Jonas[^\n]*\n)/,
            `$1${ADDED_QUOTE}\n`,
          );
      setValue(written);
      setRead(written);
      setReading(false);
    }, 1800);
  };

  const sketchpad = (
    <Sketchpad
      value={value}
      onChange={setValue}
      readOnly={reading}
      title="Clothes that outlast the season."
      page="/"
      onPageChange={() => undefined}
      status={reading ? "The assistant is reading it…" : undefined}
      onAskAssistant={sendToAssistant}
      assistantStatus={status}
      onArchive={() => undefined}
      touch
    />
  );

  return (
    <Shell
      data={mockShellData}
      theme="light"
      onThemeChange={() => undefined}
      initialSelectionId={mockSelectionIds.home}
      aiEnabled
      aiSlot={
        <AIChat
          isConnected
          authError={false}
          mode="http"
          onSendMessage={() => true}
        />
      }
      pendingChanges={3}
      // The Studio's preview: the Preview pane, a tap away.
      canvasPage={mockCanvasPage}
      canvasRoute={route}
      onCanvasRouteChange={setRoute}
      canvasRoutes={["/", "/stores", "/journal", "/about"]}
      sketchPane={
        <SketchpadWorkspace
          sketchpads={{
            sketchpads: [],
            onOpen: () => undefined,
            onReopen: () => undefined,
          }}
          sketchpad={sketchpad}
        />
      }
    />
  );
}

/** The Sketch pane, in front as it opens, with its tools at the bottom. */
export const SketchPane: Story = {};

/** The Preview pane: the Studio's own preview, of the page the sketch is about. */
export const PreviewPane: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Preview" }),
    );
  },
};

/**
 * Sent to the assistant: the button says it is reading, the sketch waits
 * while it does, and its change lands in the sketch -- a third quote.
 */
export const Sending: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: /Build/ }),
    );
  },
};
