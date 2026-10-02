/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AIChat, type AIChatHandle, type ChatMessage } from "./AIChat";
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
 * The status line under an assistant turn, driven the way `useAI` drives it:
 * through the imperative handle, one server message at a time. The rules are
 * unit tested in `aiTurnStats.test.ts`; this is the wiring — that each handle
 * call reaches the line, and that the clock pauses on a question card.
 */

const question = [
  {
    question: "Which page should I update?",
    header: "Which page?",
    options: [{ label: "Home" }, { label: "About" }],
  },
];

function renderChat(initialMessages: ChatMessage[] = []) {
  const ref = createRef<AIChatHandle>();
  render(
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <AIChat
            ref={ref}
            isConnected
            authError={false}
            mode="http"
            initialMessages={initialMessages}
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>,
  );
  if (!ref.current) throw new Error("AIChat did not mount");
  return ref.current;
}

function statusLine(): string {
  return screen.getByTestId("ai-turn-stats").textContent ?? "";
}

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
  jest.useFakeTimers();
  jest.setSystemTime(0);
});
afterEach(() => {
  jest.useRealTimers();
});

test("a turn counts up while it runs and settles to the exact count", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  expect(statusLine()).toContain("Thinking…");
  expect(statusLine()).toContain("0s");

  act(() => {
    jest.advanceTimersByTime(4_000);
  });
  expect(statusLine()).toContain("4s");

  act(() => chat.appendAssistantChunk("m1", "x".repeat(400)));
  act(() => {
    jest.advanceTimersByTime(1_000);
  });
  expect(statusLine()).toContain("Writing…");
  expect(statusLine()).toContain("↓ 100 tokens");

  act(() => chat.reportOutputTokens("m1", 2_140, false));
  act(() => {
    jest.advanceTimersByTime(1_000);
  });
  expect(statusLine()).toContain("↓ 2.1k tokens");

  act(() => chat.completeAssistantMessage("m1", { outputTokens: 2_431 }));
  act(() => {
    jest.advanceTimersByTime(30_000);
  });
  expect(statusLine()).toBe("6s·2.4k output tokens");
});

test("the clock pauses while a question card is open", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  act(() => {
    jest.advanceTimersByTime(3_000);
  });
  act(() => chat.addToolCall("m1", "q1", "ask_user_question", question));
  expect(statusLine()).toContain("Waiting for your answer");

  act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(statusLine()).toContain("3s");

  act(() => {
    screen.getByText("Home").click();
  });
  act(() => {
    screen.getByRole("button", { name: "Submit" }).click();
  });
  act(() => {
    jest.advanceTimersByTime(2_000);
  });
  expect(statusLine()).toContain("5s");
});

test("a stopped turn and a failed one say so, and a failure with no tokens shows none", () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  act(() => chat.appendAssistantChunk("m1", "x".repeat(40)));
  act(() => {
    jest.advanceTimersByTime(2_000);
  });
  act(() => chat.completeAssistantMessage("m1", { stopped: true }));
  act(() => chat.startAssistantMessage("m2"));
  act(() => {
    jest.advanceTimersByTime(5_000);
  });
  act(() => chat.errorAssistantMessage("m2", "The provider did not respond."));

  const [stopped, failed] = screen
    .getAllByTestId("ai-turn-stats")
    .map((el) => el.textContent);
  expect(stopped).toBe("Stopped after2s·~10 output tokens");
  expect(failed).toBe("Failed after5s");
});

test('the Studio\'s own "Stopped." is not counted as output', () => {
  const chat = renderChat();
  act(() => chat.startAssistantMessage("m1"));
  act(() => chat.appendAssistantChunk("m1", "Stopped.", { fromModel: false }));
  act(() => chat.completeAssistantMessage("m1", { stopped: true }));
  expect(statusLine()).toBe("Stopped after0s");
});

test("a restored session's messages show no status line", () => {
  renderChat([
    { id: "u", role: "user", content: "Hi", status: "complete" },
    { id: "a", role: "assistant", content: "Hello", status: "complete" },
  ]);
  expect(screen.queryByTestId("ai-turn-stats")).toBeNull();
});

/**
 * The chat gives up on a turn after two minutes — of SILENCE. It used to count
 * from the start of the turn, so a turn that was still working at 2:00 was
 * marked "Response timed out" and its reply was dropped when it arrived.
 */
describe("the turn timeout", () => {
  test("does not cut off a long turn that is still active", () => {
    const chat = renderChat();
    act(() => chat.startAssistantMessage("m1"));
    for (let i = 0; i < 5; i++) {
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      act(() => chat.reportOutputTokens("m1", (i + 1) * 100, false));
    }
    expect(statusLine()).toContain("Thinking…");
    expect(statusLine()).toContain("5m 00s");
    expect(screen.queryByText("Response timed out")).toBeNull();
  });

  // Before the server's first message there is no turn to time out, only the
  // "Thinking…" line under the prompt — which used to count forever.
  test("ends a prompt the server never answered", () => {
    renderChat();
    // A suggestion chip sends through the same path the composer does.
    act(() => {
      screen.getByText("Summarize recent changes").click();
    });
    expect(statusLine()).toContain("Thinking…");
    act(() => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText("Response timed out")).toBeTruthy();
    expect(statusLine()).toBe("Failed after2m 00s");
  });

  test("still ends a turn that has gone silent for two minutes", () => {
    const chat = renderChat();
    act(() => chat.startAssistantMessage("m1"));
    act(() => chat.appendAssistantChunk("m1", "Working on it"));
    act(() => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText("Response timed out")).toBeTruthy();
    expect(statusLine()).toContain("Failed after2m 00s");
  });
});
