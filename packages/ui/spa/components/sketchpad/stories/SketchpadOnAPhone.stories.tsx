import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { userEvent, within } from "storybook/test";
import { AIChat, type AIChatHandle } from "../../AIChat";
import type { AIModel, AIModelInfo } from "../../../hooks/useAIWebSocket";
import { buildSketchpadMessage } from "../SketchpadMessageCard";
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
const MODELS: AIModelInfo[] = [
  {
    ref: { provider: "anthropic", model: "claude-sonnet-5" },
    label: "Claude Sonnet 5",
  },
  {
    ref: { provider: "anthropic", model: "claude-opus-5" },
    label: "Claude Opus 5",
  },
];

function PhoneSketchpad() {
  const [value, setValue] = useState(SKETCH);
  const [read, setRead] = useState(SKETCH);
  const [reading, setReading] = useState(false);
  const [route, setRoute] = useState("/");
  const [model, setModel] = useState<AIModel | null>(MODELS[0].ref);
  const chat = useRef<AIChatHandle>(null);
  /** What `ValShell`'s `openAIPanel` hands the shell: the assistant, asked for. */
  const [restore, setRestore] = useState<{
    epoch: number;
    panel: "ai";
    canvasOpen: boolean;
    canvasView: "normal";
  }>();

  const status: SketchpadAssistantStatus = reading
    ? "reading"
    : value === read
      ? "read"
      : "changed";

  // Build, as the Studio's: the assistant comes to the front, and the
  // request to build goes into its chat -- held there, as the chat's first
  // message, until the model is chosen.
  const build = () => {
    setRestore((now) => ({
      epoch: (now?.epoch ?? 0) + 1,
      panel: "ai",
      canvasOpen: true,
      canvasView: "normal",
    }));
    chat.current?.sendUserMessage(
      buildSketchpadMessage({
        id: "autumn",
        title: "Clothes that outlast the season.",
        routes: ["/"],
      }),
    );
  };

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
      onAskAssistant={build}
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
          ref={chat}
          isConnected
          authError={false}
          mode="http"
          models={MODELS}
          selectedModel={model}
          onSelectModel={setModel}
          onSendMessage={() => {
            sendToAssistant();
            return true;
          }}
        />
      }
      pendingChanges={3}
      restoreViewState={restore}
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
 * Build on a phone: the Assistant comes to the front with the request to
 * build in it. It is the chat's first message, so it waits there with the
 * model picker until it is sent: a chat keeps the model it starts with.
 */
export const Build: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: /Build/ }),
    );
  },
};

/**
 * And sent: the assistant reads the sketch, which waits while it does, and
 * its change lands in the sketch -- a third quote.
 */
export const Sending: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Build/ }));
    await userEvent.click(await canvas.findByRole("button", { name: "Send" }));
  },
};
