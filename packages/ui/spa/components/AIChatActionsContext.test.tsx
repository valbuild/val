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

/** Stands in for whichever surface owns the chat, e.g. `AIChatSurface`. */
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
   * A surface that never calls `setOpenAIChatImpl` — a story, a preview, a
   * layout that renders no assistant — leaves a mention with nowhere to open.
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

/**
 * Asking the assistant something from elsewhere in the Studio.
 *
 * The hard case is the ordinary one: `askAssistant` OPENS the assistant, and in
 * the shell that is what mounts the surface owning `sendMessage` — so at the
 * moment of asking there is nothing to send with. The prompt is queued and
 * delivered by the registration, which is what makes one click enough.
 */
describe("askAssistant", () => {
  /** The surface, registering the send it owns. */
  function AskSurface({ sent }: { sent: string[] }) {
    const { setAskAssistantImpl } = useAIChatActions();
    useEffect(() => {
      setAskAssistantImpl((prompt) => sent.push(prompt));
      return () => setAskAssistantImpl(null);
    }, [setAskAssistantImpl, sent]);
    return null;
  }

  /** A button somewhere else entirely, e.g. the settings panel. */
  function Asker({ prompt }: { prompt: string }) {
    const { askAssistant } = useAIChatActions();
    return (
      <button type="button" onClick={() => askAssistant(prompt)}>
        ask
      </button>
    );
  }

  test("sends straight away when the surface is already there", () => {
    const sent: string[] = [];
    render(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <AskSurface sent={sent} />
        <Asker prompt="write the tone of voice" />
      </AIChatActionsProvider>,
    );
    screen.getByText("ask").click();
    expect(sent).toEqual(["write the tone of voice"]);
  });

  test("a prompt asked before the surface exists is delivered when it arrives", () => {
    // The real sequence: the button is in a panel, the assistant is not open,
    // and clicking is what opens it. Without the queue the click did nothing
    // and said nothing.
    const sent: string[] = [];
    const { rerender } = render(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <Asker prompt="write the tone of voice" />
      </AIChatActionsProvider>,
    );
    screen.getByText("ask").click();
    expect(sent).toEqual([]);
    rerender(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <AskSurface sent={sent} />
        <Asker prompt="write the tone of voice" />
      </AIChatActionsProvider>,
    );
    expect(sent).toEqual(["write the tone of voice"]);
  });

  test("a queued prompt is delivered once, not once per registration", () => {
    // `sendMessage` is a `useCallback` whose identity changes, and StrictMode
    // registers twice on mount — so the queue has to be emptied by the first
    // delivery rather than by whatever comes after it.
    const sent: string[] = [];
    const { rerender } = render(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <Asker prompt="once" />
      </AIChatActionsProvider>,
    );
    screen.getByText("ask").click();
    const tree = (key: string) => (
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <AskSurface key={key} sent={sent} />
        <Asker prompt="once" />
      </AIChatActionsProvider>
    );
    rerender(tree("a"));
    // A remount, as StrictMode's double effect and a changed `sendMessage`
    // both produce.
    rerender(tree("b"));
    expect(sent).toEqual(["once"]);
  });

  test("unregistering does not deliver anything", () => {
    const sent: string[] = [];
    const { rerender } = render(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <AskSurface sent={sent} />
        <Asker prompt="gone" />
      </AIChatActionsProvider>,
    );
    rerender(
      <AIChatActionsProvider isAIChatEnabled isAIChatOnline>
        <Asker prompt="gone" />
      </AIChatActionsProvider>,
    );
    screen.getByText("ask").click();
    expect(sent).toEqual([]);
  });
});
