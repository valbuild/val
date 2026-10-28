/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import {
  AIChat,
  type AIChatHandle,
  type AIChatTogether,
  type ChatMessage,
} from "./AIChat";
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
 * A chat several people write in: valbuild/home `docs/proposals.md`, Flow H.
 * One question runs at a time, so a message written during someone else's
 * turn waits in this tab and is sent when that turn ends.
 */

const FREDRIK = { id: "p-fredrik", name: "Fredrik Ekholdt" };
const KARI = { id: "p-kari", name: "Kari Andersen" };

function Chat({
  chatRef,
  editorRef,
  together,
  onSendMessage,
  initialMessages = [],
}: {
  chatRef: RefObject<AIChatHandle | null>;
  editorRef: RefObject<ChatEditorRef | null>;
  together: AIChatTogether;
  onSendMessage: () => boolean;
  initialMessages?: ChatMessage[];
}) {
  return (
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <AIChat
            ref={chatRef}
            chatEditorRef={editorRef}
            isConnected
            authError={false}
            mode="http"
            onCancel={() => {}}
            onSendMessage={onSendMessage}
            initialMessages={initialMessages}
            together={together}
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
});

/**
 * Enter, in the composer. Not the button: `setDocument` does not report a
 * change, so the button still thinks the composer is empty, while Enter asks
 * the editor itself.
 */
function sendWithEnter() {
  const editable = document.querySelector("[contenteditable]");
  if (!editable) throw new Error("No composer");
  fireEvent.keyDown(editable, { key: "Enter", code: "Enter", keyCode: 13 });
}

function setup() {
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const onSendMessage = jest.fn(() => true);
  const props = (turnBy: typeof KARI | null) => ({
    chatRef,
    editorRef,
    onSendMessage,
    together: { viewerId: FREDRIK.id, people: [FREDRIK, KARI], turnBy },
  });
  const view = render(<Chat {...props(KARI)} />);
  // Kari's turn is streaming here, as it does in her tab.
  act(() => chatRef.current?.startAssistantMessage("karis-turn"));
  act(() => editorRef.current?.setDocument([{ tag: "p", children: ["Hi"] }]));
  const endKarisTurn = () => {
    act(() => chatRef.current?.completeAssistantMessage("karis-turn"));
    view.rerender(<Chat {...props(null)} />);
  };
  return { editorRef, onSendMessage, endKarisTurn };
}

test("someone else's turn cannot be stopped from here", () => {
  setup();
  expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Send when the answer is done" }),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "Kari Andersen is asking",
  );
});

test("a message written during someone else's turn is sent after it", () => {
  const { onSendMessage, endKarisTurn } = setup();
  sendWithEnter();
  expect(onSendMessage).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("Then yours");

  endKarisTurn();
  expect(onSendMessage).toHaveBeenCalledTimes(1);
  // In the transcript, in this person's name.
  expect(screen.getByText("You")).toBeTruthy();
});

test("taking a queued message back puts it in the composer and sends nothing", () => {
  const { editorRef, onSendMessage, endKarisTurn } = setup();
  sendWithEnter();
  fireEvent.click(screen.getByRole("button", { name: "Take back to edit" }));
  expect(editorRef.current?.getDocument()).toEqual([
    { tag: "p", children: ["Hi"] },
  ]);

  endKarisTurn();
  expect(onSendMessage).not.toHaveBeenCalled();
});

test("messages are named only once there is more than one person", () => {
  const messages: ChatMessage[] = [
    {
      id: "m1",
      role: "user",
      content: "Rewrite the intro",
      status: "complete",
      author: FREDRIK,
    },
  ];
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const view = render(
    <Chat
      chatRef={chatRef}
      editorRef={editorRef}
      onSendMessage={() => true}
      initialMessages={messages}
      together={{ viewerId: FREDRIK.id, people: [FREDRIK] }}
    />,
  );
  expect(screen.queryByText("You")).toBeNull();
  view.unmount();

  render(
    <Chat
      chatRef={chatRef}
      editorRef={editorRef}
      onSendMessage={() => true}
      initialMessages={[
        ...messages,
        {
          id: "m2",
          role: "user",
          content: "Shorter, please",
          status: "complete",
          author: KARI,
        },
      ]}
      together={{ viewerId: FREDRIK.id, people: [FREDRIK, KARI] }}
    />,
  );
  expect(screen.getByText("You")).toBeTruthy();
  expect(screen.getByText("Kari Andersen")).toBeTruthy();
});

test("asking again after someone left is this person's question", () => {
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const onSendMessage = jest.fn(() => true);
  render(
    <Chat
      chatRef={chatRef}
      editorRef={editorRef}
      onSendMessage={onSendMessage}
      initialMessages={[
        {
          id: "k1",
          role: "user",
          content: "Update the prices",
          status: "complete",
          author: KARI,
        },
        {
          id: "k2",
          role: "assistant",
          content: "I'll look at",
          status: "error",
          error: "Kari left before the answer was done.",
        },
      ]}
      together={{ viewerId: FREDRIK.id, people: [FREDRIK, KARI] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onSendMessage).toHaveBeenCalledWith("Update the prices", undefined);
  // Kari's question stays hers, and the new one is in this person's name.
  expect(screen.getByText("Kari Andersen")).toBeTruthy();
  expect(screen.getByText("You")).toBeTruthy();
  expect(screen.getAllByText("Update the prices")).toHaveLength(2);
});
