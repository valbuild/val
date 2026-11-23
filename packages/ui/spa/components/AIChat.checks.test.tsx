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
import { CHECKS_MESSAGE_MARKER } from "../proposals/checksMessage";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

/**
 * The Studio's message for its background checks (`checksFollowUp.ts`):
 * shown as a notice, not as the person's words, and sent only while the chat
 * is idle -- a message the person queued goes first, with the findings.
 */

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const CHECKS = `${CHECKS_MESSAGE_MARKER} The checks found problems.\n\n{"lint_problems":{"problems":[]}}`;

function setup(sends = true) {
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const sent: Array<{ text: unknown; context: SendContext | undefined }> = [];
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
            onSendMessage={(text, _attachments, context) => {
              sent.push({ text, context });
              return sends;
            }}
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>,
  );
  const write = (text: string) => {
    act(() => editorRef.current?.setDocument([{ tag: "p", children: [text] }]));
    const editable = document.querySelector("[contenteditable]");
    if (!editable) throw new Error("No composer");
    fireEvent.keyDown(editable, { key: "Enter", code: "Enter", keyCode: 13 });
  };
  return { chatRef, sent, write };
}

test("sent while idle, as the Studio's: a notice, with the findings folded away", () => {
  const { chatRef, sent } = setup();
  let accepted = false;
  act(() => {
    accepted = chatRef.current?.sendChecksMessage(CHECKS) ?? false;
  });
  expect(accepted).toBe(true);
  expect(sent).toEqual([
    { text: CHECKS, context: { pointedAt: null, fromChecks: true } },
  ]);
  const notice = screen.getByRole("button", {
    name: /The checks found problems, and sent them to the assistant/,
  });
  expect(screen.queryByText(/lint_problems/)).toBeNull();
  fireEvent.click(notice);
  expect(screen.getByText(/lint_problems/)).toBeTruthy();
});

test("while a turn runs, or a message waits, it is not sent", () => {
  const { chatRef, sent, write } = setup();
  act(() => chatRef.current?.startAssistantMessage("turn-1"));
  let accepted = true;
  act(() => {
    accepted = chatRef.current?.sendChecksMessage(CHECKS) ?? true;
  });
  expect(accepted).toBe(false);

  // The person writes meanwhile: it waits, and so do the checks.
  write("And make it blue");
  act(() => chatRef.current?.completeAssistantMessage("turn-1"));
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0]?.text)).toContain("And make it blue");
  expect(sent[0]?.context?.fromChecks).toBeUndefined();
  act(() => {
    accepted = chatRef.current?.sendChecksMessage(CHECKS) ?? true;
  });
  expect(accepted).toBe(false);
});

test("a chat loaded later shows the Studio's message as the notice it was", () => {
  const { chatRef } = setup();
  act(() =>
    chatRef.current?.loadMessages([
      {
        id: "m1",
        role: "user",
        content: CHECKS,
        status: "complete",
        fromChecks: true,
      },
    ]),
  );
  expect(
    screen.getByRole("button", {
      name: /The checks found problems, and sent them to the assistant/,
    }),
  ).toBeTruthy();
  expect(screen.queryByText("You")).toBeNull();
});

test("a checks message that could not be sent is not left behind, and says so", () => {
  const { chatRef } = setup(false);
  let accepted = true;
  act(() => {
    accepted = chatRef.current?.sendChecksMessage(CHECKS) ?? true;
  });
  expect(accepted).toBe(false);
  expect(
    screen.queryByRole("button", {
      name: /The checks found problems, and sent them to the assistant/,
    }),
  ).toBeNull();
});
