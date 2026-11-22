/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AIChat, type AIChatHandle } from "./AIChat";
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
 * What the chat shows while a reply is on its way and nothing of it is here
 * yet: the model's thinking, and the tool call it is still writing. Driven
 * the way `useAI` drives it, through the imperative handle.
 */
function renderChat() {
  const ref = createRef<AIChatHandle>();
  render(
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <AIChat ref={ref} isConnected authError={false} mode="http" />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>,
  );
  if (!ref.current) throw new Error("AIChat did not mount");
  return ref.current;
}

const thinking = () => screen.queryByTestId("ai-thinking")?.textContent;
const page = () => document.body.textContent ?? "";

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
});

test("the model's thinking shows as one line, until it says or does something", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  expect(thinking()).toBeUndefined();

  act(() => chat.appendThinking("m1", "Reading the hero.\n"));
  act(() => chat.appendThinking("m1", "Now the title"));
  expect(thinking()).toBe("Now the title");

  act(() => chat.appendAssistantChunk("m1", "Done."));
  expect(thinking()).toBeUndefined();
});

test("a call being written has a row with its file, and becomes the call without a second row", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  act(() => chat.appendThinking("m1", "Planning"));

  act(() => chat.noteToolCallWriting("m1", "t1", "edit_file"));
  expect(page()).toContain("Changing the code…");
  // It is doing something now: the thinking line is over.
  expect(thinking()).toBeUndefined();

  act(() => chat.noteToolCallWriting("m1", "t1", "edit_file", "src/Hero.tsx"));
  expect(page()).toContain("Changing the code: src/Hero.tsx…");

  // The call itself: the same row, still running, its file kept.
  act(() => chat.addToolCall("m1", "t1", "edit_file"));
  expect(page()).toContain("Changing the code: src/Hero.tsx…");
  expect(page()).not.toContain("Used 2 tools");

  // A late word about writing it changes nothing.
  act(() => chat.noteToolCallWriting("m1", "t1", "edit_file", "other.tsx"));
  expect(page()).not.toContain("other.tsx");

  act(() => chat.completeToolCall("m1", "t1"));
  act(() => chat.completeAssistantMessage("m1"));
  expect(page()).toContain("Changing the code");
  expect(page()).not.toContain("Used 2 tools");
});

test("a call that never comes leaves no row: dropped, or its turn ended", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  act(() => chat.noteToolCallWriting("m1", "t1", "edit_file", "a.tsx"));
  act(() => chat.dropToolCallWriting("m1", "t1"));
  expect(page()).not.toContain("Changing the code");

  act(() => chat.noteToolCallWriting("m1", "t2", "write_files", "b.tsx"));
  act(() => chat.appendThinking("m1", "Hm"));
  act(() => chat.completeAssistantMessage("m1"));
  expect(page()).not.toContain("Changing the code");
  expect(thinking()).toBeUndefined();
});
