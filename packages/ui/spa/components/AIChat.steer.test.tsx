/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AIChat, type AIChatHandle, type SendContext } from "./AIChat";
import type { ChatEditorRef } from "./AIChatEditor";
import { STEER_ACK_TIMEOUT_MS } from "./aiSteer";
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
 * Steering: what the person writes while their own turn runs is sent into
 * it at once, and what the server says about it (`ai_steer_status`) moves
 * it on. See `aiSteer.ts`.
 */

beforeEach(() => {
  // jsdom has no layout; the chat scrolls to the newest message on every change.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  jest.useRealTimers();
});

type Steered = { text: string; steerId: string; context?: SendContext };

function setup(options?: { steerSucceeds?: boolean }) {
  const chatRef = createRef<AIChatHandle>();
  const editorRef = createRef<ChatEditorRef>();
  const prompts: string[] = [];
  const steered: Steered[] = [];
  const onCancel = jest.fn();
  const plain = (content: unknown) =>
    Array.isArray(content) ? JSON.stringify(content) : String(content);
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
            onSendMessage={(content) => {
              prompts.push(plain(content));
              return true;
            }}
            onSteerMessage={(content, _attachments, context, steerId) => {
              if (options?.steerSucceeds === false) return false;
              steered.push({ text: plain(content), steerId, context });
              return true;
            }}
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
  /** The assistant answers the prompt sent last, and is still answering. */
  const answering = () => {
    turn++;
    const id = `turn-${turn}`;
    act(() => chatRef.current?.startAssistantMessage(id));
    return {
      id,
      say: (chunk: string) =>
        act(() => chatRef.current?.appendAssistantChunk(id, chunk)),
      tool: (toolCallId: string) =>
        act(() => chatRef.current?.addToolCall(id, toolCallId, "get_source")),
      done: () => act(() => chatRef.current?.completeAssistantMessage(id)),
      stopped: () =>
        act(() =>
          chatRef.current?.completeAssistantMessage(id, { stopped: true }),
        ),
    };
  };
  const status = (
    steerId: string,
    value: "accepted" | "delivered" | "too_late" | "rejected",
    reason?: string,
  ) => act(() => chatRef.current?.steerStatus(steerId, value, reason));
  /** The transcript, top to bottom: who said what. */
  const transcript = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".prose, .bg-bg-secondary"),
    )
      .filter((el) => el.closest("[aria-label='Queued messages']") === null)
      .map((el) => el.textContent ?? "");
  return {
    chatRef,
    editorRef,
    write,
    answering,
    status,
    prompts,
    steered,
    onCancel,
    transcript,
  };
}

const queueRegion = () =>
  screen.queryByRole("region", { name: "Queued messages" });

test("a message written during the person's own turn is steered into it, and marked as sent", () => {
  const { write, answering, prompts, steered, status } = setup();
  write("Make the title shorter");
  answering();

  write("Actually, only the first one");
  expect(prompts).toHaveLength(1);
  expect(steered).toHaveLength(1);
  expect(steered[0].text).toContain("Actually, only the first one");
  // On screen at once, and not in the queue.
  expect(queueRegion()).toBeNull();
  expect(screen.getByText("Actually, only the first one")).toBeTruthy();
  expect(
    document.querySelector("[data-steer-state='sending']")?.textContent,
  ).toContain("the assistant will read it at its next step");

  status(steered[0].steerId, "accepted");
  expect(
    document.querySelector("[data-steer-state='accepted']")?.textContent,
  ).toContain("can no longer be edited");
});

test("delivered puts it between the assistant's steps, as a normal user message", () => {
  const { write, answering, steered, status, transcript, chatRef } = setup();
  write("Fix the typos");
  const turn = answering();
  turn.tool("call-1");
  turn.say("Looking at the posts.");

  write("Skip the about page");
  status(steered[0].steerId, "accepted");
  status(steered[0].steerId, "delivered");
  expect(document.querySelector("[data-steer-state]")).toBeNull();

  turn.say("Done, without the about page.");
  turn.done();

  const shown = transcript();
  const before = shown.findIndex((t) => t.includes("Looking at the posts."));
  const steer = shown.findIndex((t) => t.includes("Skip the about page"));
  const after = shown.findIndex((t) =>
    t.includes("Done, without the about page."),
  );
  expect(before).toBeGreaterThan(-1);
  expect(steer).toBeGreaterThan(before);
  expect(after).toBeGreaterThan(steer);
  // The tool row from before the steer still answers to the turn.
  act(() => chatRef.current?.completeToolCall(turn.id, "call-1"));
});

test("too_late sends it as the next prompt, once the turn has ended", () => {
  const { write, answering, prompts, steered, status } = setup();
  write("First");
  const turn = answering();
  write("Second");
  status(steered[0].steerId, "accepted");
  turn.done();
  // The turn's end queues it already; too_late says the same and must not
  // send it a second time.
  status(steered[0].steerId, "too_late");
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Second");
  status(steered[0].steerId, "too_late");
  expect(prompts).toHaveLength(2);
});

test("too_late keeps the order of what was written", () => {
  const { write, answering, prompts, steered, status } = setup();
  write("First");
  const first = answering();
  write("Second");
  write("Third");
  expect(steered.map((s) => s.text)).toEqual([
    expect.stringContaining("Second"),
    expect.stringContaining("Third"),
  ]);
  // The server answers them out of order.
  status(steered[1].steerId, "too_late");
  status(steered[0].steerId, "too_late");
  first.done();
  expect(prompts[1]).toContain("Second");
  const second = answering();
  second.done();
  expect(prompts[2]).toContain("Third");
  expect(prompts).toHaveLength(3);
});

test("rejected gives it back in the composer with the reason, when nothing is being written", () => {
  const { write, answering, status, steered, editorRef, prompts } = setup();
  write("First");
  answering();
  write("Second");
  status(steered[0].steerId, "rejected", "Only the person who asked can.");
  expect(screen.getByRole("status").textContent).toContain(
    "Only the person who asked can.",
  );
  expect(editorRef.current?.isEmpty()).toBe(false);
  expect(document.querySelector("[data-steer-state]")).toBeNull();
  expect(prompts).toHaveLength(1);
});

test("rejected while something else is being written stays in the chat, to edit or remove", () => {
  const { write, answering, status, steered, editorRef, prompts } = setup();
  write("First");
  const turn = answering();
  write("Second");
  act(() =>
    editorRef.current?.setDocument([{ tag: "p", children: ["Typing"] }]),
  );
  status(steered[0].steerId, "rejected", "Not now.");
  const row = document.querySelector("[data-steer-state='rejected']");
  expect(row?.textContent).toContain("Not now.");
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  // A rejected steer is not sent when the turn ends.
  turn.done();
  expect(prompts).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(document.querySelector("[data-steer-state]")).toBeNull();
});

test("no word from the server in time queues it, as before steering existed", () => {
  jest.useFakeTimers();
  const { write, answering, steered, prompts } = setup();
  write("First");
  const turn = answering();
  write("Second");
  expect(queueRegion()).toBeNull();
  act(() => {
    jest.advanceTimersByTime(STEER_ACK_TIMEOUT_MS);
  });
  expect(document.querySelector("[data-steer-state]")).toBeNull();
  expect(queueRegion()?.textContent).toContain("Second");
  // While anything is queued, more writing queues behind it rather than
  // overtaking it.
  write("Third");
  expect(steered).toHaveLength(1);
  turn.done();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Second");
});

test("a late accepted after the fallback takes it out of the queue: it is not sent twice", () => {
  jest.useFakeTimers();
  const { write, answering, steered, prompts, status } = setup();
  write("First");
  const turn = answering();
  write("Second");
  act(() => {
    jest.advanceTimersByTime(STEER_ACK_TIMEOUT_MS);
  });
  expect(queueRegion()?.textContent).toContain("Second");

  status(steered[0].steerId, "accepted");
  expect(queueRegion()).toBeNull();
  expect(document.querySelector("[data-steer-state='accepted']")).toBeTruthy();
  status(steered[0].steerId, "delivered");
  turn.done();
  expect(prompts).toHaveLength(1);
  expect(screen.getByText("Second")).toBeTruthy();
});

test("Stop puts what was steered and not read back in the queue, which waits", () => {
  const { write, answering, steered, prompts, status, onCancel } = setup();
  write("First");
  const turn = answering();
  write("Second");
  status(steered[0].steerId, "accepted");
  fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
  expect(onCancel).toHaveBeenCalled();
  turn.stopped();
  const queue = queueRegion();
  expect(queue?.textContent).toContain("Second");
  expect(queue?.textContent).toContain("Stopped");
  expect(prompts).toHaveLength(1);
  // The server's late word on it changes nothing.
  status(steered[0].steerId, "too_late");
  expect(prompts).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Send next" }));
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Second");
});

test("when it cannot be steered, it waits in the queue as before", () => {
  const { write, answering, steered, prompts } = setup({
    steerSucceeds: false,
  });
  write("First");
  const turn = answering();
  write("Second");
  expect(steered).toHaveLength(0);
  expect(queueRegion()?.textContent).toContain("Second");
  turn.done();
  expect(prompts[1]).toContain("Second");
});

test("delivered for the same steer again, or by another route, shows it once", () => {
  const { write, answering, steered, status, chatRef } = setup();
  write("First");
  const turn = answering();
  turn.say("Working");
  write("Second");
  status(steered[0].steerId, "accepted");
  status(steered[0].steerId, "delivered");
  turn.say(" on it");
  // The server answers a re-sent steerId with `delivered` again, and a tab
  // can hear of it raw and from a watch.
  status(steered[0].steerId, "delivered");
  act(() =>
    chatRef.current?.showSteer(steered[0].steerId, {
      id: "x",
      role: "user",
      content: "Second",
      status: "complete",
    }),
  );
  turn.done();
  expect(screen.getAllByText("Second")).toHaveLength(1);
});

test("someone else's delivered steer goes where the watched turn has got to", () => {
  const { answering, chatRef, transcript } = setup();
  const turn = answering();
  turn.say("Found 12 pages.");
  act(() =>
    chatRef.current?.showSteer("theirs", {
      id: "theirs",
      role: "user",
      content: "Only the blog posts",
      status: "complete",
    }),
  );
  turn.say("Fixed the 4 posts.");
  turn.done();
  const shown = transcript();
  const at = (text: string) => shown.findIndex((t) => t.includes(text));
  expect(at("Found 12 pages.")).toBeLessThan(at("Only the blog posts"));
  expect(at("Only the blog posts")).toBeLessThan(at("Fixed the 4 posts."));
});

test("a message of only spaces is not sent, and is not steered", () => {
  const { write, answering, steered, prompts } = setup();
  write("First");
  answering();
  write("   ");
  expect(steered).toHaveLength(0);
  expect(prompts).toHaveLength(1);
  expect(queueRegion()).toBeNull();
});
