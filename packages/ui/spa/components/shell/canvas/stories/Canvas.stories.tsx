import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CanvasView } from "../CanvasView";
import { mockCanvasChat, mockCanvasPage } from "../mockCanvasPage";
import { CanvasDevice, CanvasPane } from "../types";

/**
 * An experiment: what editing looks like if the page goes on a canvas.
 *
 * Three ideas are being tried together, and they are worth judging
 * separately:
 *
 * 1. **The page on a pan/zoom canvas.** It keeps its own width and layout —
 *    the canvas only moves and scales it — so a 1280px page stays a 1280px
 *    page while you zoom out far enough to see all of it.
 * 2. **Every field at the side.** Instead of hunting across the page for the
 *    thing to change, the page's content is a list you read top to bottom and
 *    can filter. The canvas becomes for seeing the result, not for aiming.
 * 3. **Pick on the page, hand it to the assistant.** Selected elements
 *    collect as chips above the chat input, so a message can be about the
 *    thing you are pointing at rather than a description of it.
 *
 * On a phone the halves become panes that snap horizontally, chat left and
 * canvas right, as Lovable does it.
 *
 * Nothing here is wired to real data.
 */
const meta: Meta<typeof CanvasHarness> = {
  title: "Shell/Canvas (experiment)",
  component: CanvasHarness,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  argTypes: {
    theme: { control: "inline-radio", options: ["dark", "light"] },
    device: {
      control: "inline-radio",
      options: ["desktop", "tablet", "mobile"],
    },
    pane: { control: "inline-radio", options: ["chat", "canvas"] },
    selectedFieldId: {
      control: "select",
      options: [null, "headline", "intro", "cat1Image", "storyTitle"],
    },
    animate: {
      control: "boolean",
      description: "Play the entrance transition rather than starting settled",
    },
  },
};
export default meta;

type HarnessProps = {
  theme: "dark" | "light";
  /** Width the page is rendered at inside the canvas. */
  device: CanvasDevice;
  pane: CanvasPane;
  selectedFieldId: string | null;
  attached: string[];
  animate: boolean;
  isDevMode: boolean;
};

function CanvasHarness({
  theme,
  device,
  pane,
  selectedFieldId,
  attached,
  animate,
  isDevMode,
}: HarnessProps) {
  const [exited, setExited] = useState(false);
  return (
    <div data-mode={theme}>
      {exited ? (
        <div
          style={{ height: "100svh" }}
          className="grid place-items-center bg-bg-canvas text-fg-secondary"
        >
          <button
            type="button"
            onClick={() => setExited(false)}
            className="rounded-md border border-border-float px-3 py-2 text-xs hover:bg-bg-float-raised"
          >
            Open the canvas again
          </button>
        </div>
      ) : (
        <CanvasView
          key={`${device}-${pane}-${selectedFieldId}`}
          page={mockCanvasPage}
          initialChat={mockCanvasChat}
          initialDevice={device}
          initialPane={pane}
          initialSelectedFieldId={selectedFieldId}
          initialAttachedFieldIds={attached}
          skipTransition={!animate}
          isDevMode={isDevMode}
          onExit={() => setExited(true)}
        />
      )}
    </div>
  );
}

type Story = StoryObj<typeof CanvasHarness>;

const base: HarnessProps = {
  theme: "dark",
  device: "desktop",
  pane: "canvas",
  selectedFieldId: null,
  attached: [],
  animate: false,
  isDevMode: false,
};

/** The whole idea in one screen: assistant, canvas, fields. */
export const Default: Story = { args: base };

/**
 * A field selected. The canvas outlines it and the side panel scrolls to it —
 * selection is shared, so the two halves never drift apart.
 */
export const FieldSelected: Story = {
  args: { ...base, selectedFieldId: "headline" },
};

/**
 * Two elements picked off the page and handed to the assistant. The chips
 * above the input are what the next message will be about.
 */
export const AttachedToAssistant: Story = {
  args: {
    ...base,
    selectedFieldId: "storyTitle",
    attached: ["headline", "storyTitle"],
  },
};

/** The page at tablet width, so the canvas is showing a different layout. */
export const TabletWidth: Story = { args: { ...base, device: "tablet" } };

/** The page at phone width — still on a desktop canvas. */
export const MobileWidth: Story = { args: { ...base, device: "mobile" } };

/** Source paths under every field. */
export const DevMode: Story = {
  args: { ...base, isDevMode: true, selectedFieldId: "intro" },
};

/** Light mode. */
export const LightMode: Story = { args: { ...base, theme: "light" } };

/**
 * On a phone, the canvas pane. The toggle in the header moves between this
 * and the chat; so does a horizontal swipe.
 */
export const PhoneCanvasPane: Story = { args: { ...base, pane: "canvas" } };

/** On a phone, the chat pane, with elements already attached. */
export const PhoneChatPane: Story = {
  args: { ...base, pane: "chat", attached: ["headline", "cat1Image"] },
};

/**
 * Plays the entrance: the view scales and fades up from slightly small, which
 * reads as stepping back from the page rather than as a new screen arriving.
 */
export const Entering: Story = { args: { ...base, animate: true } };
