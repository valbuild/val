/** @jest-environment jsdom */
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import {
  AIChatActionsProvider,
  useAIChatActions,
} from "./AIChatActionsContext";

/**
 * When a field may offer "mention this in the assistant".
 *
 * The button used to be gated on config alone, so it appeared in a studio whose
 * socket never connected, and in a layout that has no live chat at all — and in
 * both cases clicking it opened nothing and reported nothing. Three conditions
 * have to hold, and each one of them has been the failing one, so each is
 * pinned separately.
 */
function Probe() {
  const { canMentionField } = useAIChatActions();
  return (
    <span data-testid="can-mention">{canMentionField ? "yes" : "no"}</span>
  );
}

/** Stands in for whichever layout owns the chat, e.g. `ToolsMenu`. */
function ChatSurface() {
  const { setOpenAIChatImpl } = useAIChatActions();
  useEffect(() => {
    setOpenAIChatImpl(() => undefined);
    return () => setOpenAIChatImpl(null);
  }, [setOpenAIChatImpl]);
  return null;
}

const canMention = () => screen.getByTestId("can-mention").textContent;

function tree(opts: {
  enabled: boolean;
  online: boolean;
  withChatSurface: boolean;
}) {
  return (
    <AIChatActionsProvider
      isAIChatEnabled={opts.enabled}
      isAIChatOnline={opts.online}
    >
      {opts.withChatSurface && <ChatSurface />}
      <Probe />
    </AIChatActionsProvider>
  );
}

describe("canMentionField", () => {
  test("all three conditions met", () => {
    render(tree({ enabled: true, online: true, withChatSurface: true }));
    expect(canMention()).toBe("yes");
  });

  test("not when the project has no assistant", () => {
    render(tree({ enabled: false, online: true, withChatSurface: true }));
    expect(canMention()).toBe("no");
  });

  /** The reported bug: configured, so the button showed; socket down, so it did nothing. */
  test("not while the assistant is offline", () => {
    render(tree({ enabled: true, online: false, withChatSurface: true }));
    expect(canMention()).toBe("no");
  });

  /**
   * The new shell's assistant panel is a design placeholder — it never calls
   * `setOpenAIChatImpl` — so a mention there would open nothing at all.
   */
  test("not when no layout is offering a chat", () => {
    render(tree({ enabled: true, online: true, withChatSurface: false }));
    expect(canMention()).toBe("no");
  });

  test("stops offering when the chat surface unmounts", () => {
    const { rerender } = render(
      tree({ enabled: true, online: true, withChatSurface: true }),
    );
    expect(canMention()).toBe("yes");
    rerender(tree({ enabled: true, online: true, withChatSurface: false }));
    expect(canMention()).toBe("no");
  });
});
