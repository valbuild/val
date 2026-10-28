/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AIChat, type AIChatHandle, type SendContext } from "./AIChat";
import type { ChatEditorRef } from "./AIChatEditor";
import { TooltipProvider } from "./designSystem/tooltip";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValThemeProvider } from "./ValThemeProvider";

// ESM-only, which this jest setup does not transform; the markdown is not
// what is under test.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

/**
 * Writing while the assistant answers: what is written waits in a queue and
 * is sent one per turn, after the turn before has ended.
 */

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
});

function setup(options?: { capture?: () => SendContext }) {
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const sent: Array<{ text: unknown; context: SendContext | undefined }> = [];
  const onCancel = jest.fn();
  const onSendMessage = jest.fn(
    (text: unknown, _attachments?: unknown, context?: SendContext) => {
      sent.push({ text, context });
      return true;
    },
  );
  render(
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <AIChat
            ref={chatRef}
            chatEditorRef={editorRef}
            isConnected
            authError={false}
            mode="http"
            onCancel={onCancel}
            onSendMessage={onSendMessage}
            {...(options?.capture
              ? { onCaptureSendContext: options.capture }
              : {})}
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>,
  );
  /** Write `text` in the composer and press Enter. */
  const write = (text: string) => {
    act(() => editorRef.current?.setDocument([{ tag: "p", children: [text] }]));
    const editable = document.querySelector("[contenteditable]");
    if (!editable) throw new Error("No composer");
    fireEvent.keyDown(editable, { key: "Enter", code: "Enter", keyCode: 13 });
  };
  let turn = 0;
  /** The assistant answers the message sent last, and is still answering. */
  const answering = () => {
    turn++;
    const id = `turn-${turn}`;
    act(() => chatRef.current?.startAssistantMessage(id));
    return {
      done: () => act(() => chatRef.current?.completeAssistantMessage(id)),
      fail: () =>
        act(() => chatRef.current?.errorAssistantMessage(id, "It broke")),
    };
  };
  return { write, answering, sent, onCancel };
}

const texts = (sent: Array<{ text: unknown }>) =>
  sent.map(({ text }) =>
    Array.isArray(text) ? JSON.stringify(text) : String(text),
  );

test("what is written during a turn waits, and is sent when it ends, one per turn", () => {
  const { write, answering, sent } = setup();
  write("First");
  expect(sent).toHaveLength(1);
  const first = answering();

  // The composer is not blocked by the turn.
  expect(document.querySelector("[contenteditable='false']")).toBeNull();
  write("Second");
  write("Third");
  expect(sent).toHaveLength(1);
  const queue = screen.getByRole("region", { name: "Queued messages" });
  expect(queue.textContent).toContain("Second");
  expect(queue.textContent).toContain("Third");

  first.done();
  expect(sent).toHaveLength(2);
  expect(texts(sent)[1]).toContain("Second");
  // Third waits for the turn Second started.
  const second = answering();
  expect(sent).toHaveLength(2);
  second.done();
  expect(sent).toHaveLength(3);
  expect(texts(sent)[2]).toContain("Third");
  expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
});

test("Stop holds the queue until the person says to go on", () => {
  const { write, answering, sent, onCancel } = setup();
  write("First");
  const first = answering();
  write("Second");
  fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
  expect(onCancel).toHaveBeenCalled();
  first.done();
  expect(sent).toHaveLength(1);
  const queue = screen.getByRole("region", { name: "Queued messages" });
  expect(queue.textContent).toContain("Stopped");

  fireEvent.click(screen.getByRole("button", { name: "Send next" }));
  expect(sent).toHaveLength(2);
  expect(texts(sent)[1]).toContain("Second");
});

test("a failed turn holds the queue, and Clear empties it", () => {
  const { write, answering, sent } = setup();
  write("First");
  const first = answering();
  write("Second");
  first.fail();
  expect(sent).toHaveLength(1);
  expect(
    screen.getByRole("region", { name: "Queued messages" }).textContent,
  ).toContain("failed");
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
  expect(sent).toHaveLength(1);
});

test("a queued message keeps what was picked when it was written", () => {
  const picked = {
    tag: "h2",
    text: "Our people",
    classes: [],
    selector: "main > h2",
  };
  let pickedNow: typeof picked | null = picked;
  const { write, answering, sent } = setup({
    capture: () => {
      const pointedAt = pickedNow;
      pickedNow = null;
      return { pointedAt };
    },
  });
  write("First");
  const first = answering();
  write("Make this bigger");
  first.done();
  expect(sent[1]?.context).toEqual({ pointedAt: picked });
});
