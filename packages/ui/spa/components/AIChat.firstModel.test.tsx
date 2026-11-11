/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import { AIChat, type AIChatHandle } from "./AIChat";
import type { AIModelInfo } from "../hooks/useAIWebSocket";
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
 * A chat's first message, sent from outside the composer -- the Sketchpad's
 * Build -- waits for the person to choose the model: a chat keeps the model
 * it starts with, and they did not type this message, so nothing else would
 * have shown them the choice.
 */

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
});

const SONNET: AIModelInfo = {
  ref: { provider: "anthropic", model: "claude-sonnet-5" },
  label: "Claude Sonnet 5",
};
const OPUS: AIModelInfo = {
  ref: { provider: "anthropic", model: "claude-opus-5" },
  label: "Claude Opus 5",
};
const BUILD = "Build this sketchpad.";

function setup(models: AIModelInfo[]) {
  const chatRef = createRef<AIChatHandle>();
  const sent: unknown[] = [];
  function Chat() {
    const [selected, setSelected] = useState(models[0]?.ref ?? null);
    return (
      <AIChat
        ref={chatRef}
        isConnected
        authError={false}
        mode="http"
        models={models}
        selectedModel={selected}
        onSelectModel={setSelected}
        onSendMessage={(text) => {
          sent.push(text);
          return true;
        }}
      />
    );
  }
  render(
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Chat />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>,
  );
  const build = () => act(() => chatRef.current?.sendUserMessage(BUILD));
  return { build, sent, chatRef };
}

describe("a first message sent from outside the composer", () => {
  test("waits for the model, with the picker and Send", () => {
    const { build, sent } = setup([SONNET, OPUS]);
    build();
    expect(sent).toEqual([]);
    const ready = screen.getByRole("region", { name: "Ready to send" });
    expect(ready.textContent).toContain(BUILD);
    expect(
      within(ready).getByRole("button", { name: /Claude Sonnet 5/ }),
    ).toBeTruthy();

    fireEvent.click(within(ready).getByRole("button", { name: "Send" }));
    expect(sent).toEqual([BUILD]);
    expect(screen.queryByRole("region", { name: "Ready to send" })).toBeNull();
  });

  test("can be cancelled, and nothing is sent", () => {
    const { build, sent } = setup([SONNET, OPUS]);
    build();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Ready to send" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(sent).toEqual([]);
    expect(screen.queryByRole("region", { name: "Ready to send" })).toBeNull();
  });

  test("goes straight away with only one model to choose", () => {
    const { build, sent } = setup([SONNET]);
    build();
    expect(sent).toEqual([BUILD]);
    expect(screen.queryByRole("region", { name: "Ready to send" })).toBeNull();
  });

  test("started meanwhile, it is offered to that chat, without a model to choose", () => {
    const { build, sent, chatRef } = setup([SONNET, OPUS]);
    build();
    // Another conversation opened while it waited: its model is settled.
    act(() =>
      chatRef.current?.loadMessages([
        { id: "earlier", role: "user", content: "Hello", status: "complete" },
      ]),
    );
    const ready = screen.getByRole("region", { name: "Ready to send" });
    expect(ready.textContent).toContain("Send this to the chat?");
    expect(within(ready).queryByRole("button", { name: /Claude/ })).toBeNull();
    fireEvent.click(within(ready).getByRole("button", { name: "Send" }));
    expect(sent).toEqual([BUILD]);
  });

  test("goes straight away once the chat has started", () => {
    const { build, sent, chatRef } = setup([SONNET, OPUS]);
    act(() =>
      chatRef.current?.loadMessages([
        { id: "earlier", role: "user", content: "Hello", status: "complete" },
      ]),
    );
    build();
    expect(sent).toEqual([BUILD]);
  });
});
