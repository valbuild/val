import type { Meta, StoryObj } from "@storybook/react";
import { workspaceLayout } from "../workspaceLayout";
import { ResizableWorkspace } from "./ResizableWorkspace";
import {
  WorkspaceMock,
  describeLayout,
  useMockState,
  type MockState,
} from "./WorkspaceMock";

/**
 * A prototype of the one workspace: Content | Preview | Sketch | Assistant,
 * laid out by `workspaceLayout` at any width. The preview is the same in
 * every mode, and code mode only changes what Select can pick.
 */
const meta: Meta = {
  title: "Shell/Workspace layout (prototype)",
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Drag the handle, or pick a window size. */
export const Resizable: Story = {
  render: () => (
    <div className="min-h-screen bg-bg-primary p-4">
      <ResizableWorkspace />
    </div>
  ),
};

function AtSize({
  width,
  height,
  initial,
}: {
  width: number;
  height: number;
  initial?: Partial<MockState>;
}) {
  const controls = useMockState(initial);
  return (
    <div className="inline-flex flex-col bg-bg-primary">
      <p className="px-3 py-2 font-sans text-xs text-fg-secondary">
        <span className="font-medium tabular-nums text-fg-primary">
          {width} × {height}
        </span>{" "}
        · {describeLayout(workspaceLayout({ width, ...controls.state }))}
      </p>
      <WorkspaceMock width={width} height={height} controls={controls} />
    </div>
  );
}

const at = (
  width: number,
  height: number,
  initial?: Partial<MockState>,
): Story => ({
  render: () => <AtSize width={width} height={height} initial={initial} />,
});

/** Room for everything: four columns. */
export const Ultrawide2560 = at(2560, 1440);

/** Sketch and the assistant share a column; Content and the preview keep theirs. */
export const Desktop1920 = at(1920, 1080);

/** Sketch in front of its tab: Build where the Select was. */
export const Desktop1920Sketching = at(1920, 1080, {
  front: "sketch",
  recent: ["sketch", "content", "chat"],
});

/** As wide as a 14" MacBook gets. */
export const MacBook1512 = at(1512, 945);

/** Editing content: Sketch and the assistant fold to a strip on the right. */
export const Laptop1366Editing = at(1366, 768);

/** Talking to the assistant: now Content folds, on the left. */
export const Laptop1366Chatting = at(1366, 768, {
  recent: ["chat", "content", "sketch"],
});

/** Option (b): Content comes over the preview, and the assistant stays. */
export const Laptop1366Overlay = at(1366, 768, { narrow: "overlay" });

/** Content's Select, at the end of its header: fields, solid. A click opens one. */
export const ContentSelect = at(1512, 945, {
  selecting: "content",
  focused: "lead",
});

/** Sketch and Assistant's Select, at the start of their header: fields only, outside code mode. */
export const AssistantPointing = at(1512, 945, {
  selecting: "chat",
  hovered: "p.lead · “Six new dishes…”",
  recent: ["chat", "content", "sketch"],
});

/** Sketch and Assistant's Select in code mode: anything, the footer included. */
export const CodeModePointing = at(1920, 1080, {
  codeMode: true,
  selecting: "chat",
  pointedAt: "h1 · “Spring has come to Oslo”",
  hovered: "footer",
});

/** The Preview turned off: Content is in the middle, at a readable width. */
export const PreviewOff1512 = at(1512, 945, {
  open: { content: true, preview: false, sketch: true, chat: true },
  selecting: null,
});

/** The Preview turned off, writing with the assistant: Content and the chat. */
export const PreviewOff1366 = at(1366, 768, {
  open: { content: true, preview: false, sketch: false, chat: true },
  selecting: null,
});

/** A tablet: Content beside the preview, the rest a strip. */
export const Tablet1024 = at(1024, 768);

/** A tablet, with the assistant in use: a sheet over the preview. */
export const Tablet1024Chatting = at(1024, 768, {
  recent: ["chat", "content", "sketch"],
});

/** A tablet, sketching: the Sketch tab in front, with Build. */
export const Tablet1024Sketching = at(1024, 768, {
  front: "sketch",
  recent: ["sketch", "content", "chat"],
});

/** A phone: one pane at a time. */
export const Phone = at(390, 844);

/** A phone, on the Sketch tab: its name, and Build. */
export const PhoneSketch = at(390, 844, { phonePane: "sketch" });

/** A phone, after Content's Select: the preview, picking a field. */
export const PhoneContentSelect = at(390, 844, {
  phonePane: "preview",
  selecting: "content",
});

/** A phone in code mode, pointing for the assistant. */
export const PhoneCodeModePointing = at(390, 844, {
  codeMode: true,
  phonePane: "preview",
  selecting: "chat",
  hovered: "footer",
});
