import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import { AIChat } from "../../AIChat";
import { Shell } from "../../shell/Shell";
import { mockSelectionIds, mockShellData } from "../../shell/mockShellData";
import { Sketchpad, type SketchpadAssistantStatus } from "../Sketchpad";
import { SketchpadWorkspace } from "../SketchpadWorkspace";
import { PreviewMock, SKETCH } from "./sketchpadFixtures";

/**
 * The Sketchpad on a phone. There is no room for the page beside the sketch,
 * so the Sketchpad offers the whole screen to the two of them instead: the
 * full-screen button in its header covers the Studio's bars and leaves the
 * title at the top. Everything else is at the bottom, where the thumb is: the
 * tools, and under them one bar -- the chat at the left, as in the Studio's
 * own bar; one button to the other view (it says **Page** on the sketch and
 * **Sketch** on the page); **Send to AI**; and **X** to leave.
 *
 * The sheet is pinned to what is visible, as the overlay's full-screen sheets
 * are, so with the keyboard up the tools sit on top of it -- and "Send to AI"
 * steps aside while typing, and is back when the keyboard goes.
 *
 * Box buttons (add an image, remove it) are always shown on a touch screen,
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

type Props = {
  /** Opens in full screen, rather than in the Studio's column. */
  fullscreen: boolean;
};

function PhoneSketchpad({ fullscreen }: Props) {
  const [value, setValue] = useState(SKETCH);
  const [read, setRead] = useState(SKETCH);
  const [reading, setReading] = useState(false);

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
      fullscreenPreview={<PreviewMock />}
      defaultFullscreen={fullscreen}
      onOpenChat={() => undefined}
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
      workspaceOverride={
        <SketchpadWorkspace
          preview={<PreviewMock />}
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

/**
 * In the Studio's column, as it opens: the full-screen button is beside the
 * archive button in the Sketchpad's header.
 */
export const InTheStudio: Story = {
  args: { fullscreen: false },
};

/** Full screen, on the sketch: the tools at the bottom, Send to AI under them. */
export const FullScreen: Story = {
  args: { fullscreen: true },
};

/** Full screen, on the page it sketches: the button now says Sketch. */
export const FullScreenOnThePage: Story = {
  args: { fullscreen: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Page" }),
    );
  },
};

/**
 * Sent to the assistant: the button says it is reading, the sketch waits
 * while it does, and its change lands in the sketch -- a third quote.
 */
export const FullScreenSending: Story = {
  args: { fullscreen: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: /Send to AI/ }),
    );
  },
};
