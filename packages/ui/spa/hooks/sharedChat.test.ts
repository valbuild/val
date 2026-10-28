import type { ProposalParticipant } from "../components/proposals/types";
import {
  applyWatchedEvent,
  runningAsker,
  someoneElseAdded,
  storedToolActivities,
  watchedQuestionText,
  type WatchedChat,
} from "./sharedChat";
import { AIServerMessage, type AIWatchedMessage } from "./useAIWebSocket";

/**
 * A proposal's chat, read again every few seconds (valbuild/home
 * `docs/proposals.md`, Flow H): whose question is running, and when the
 * screen has to show the chat again.
 */

const ME = "p-fredrik";
const KARI = "p-kari";

const ask = (authorId: string, text = "?") => ({
  role: "user",
  content: text,
  authorId,
});
const answer = (text = "!") => ({ role: "assistant", content: text });

describe("runningAsker", () => {
  test("someone else's unanswered question is theirs to run", () => {
    expect(runningAsker([ask(ME), answer(), ask(KARI)], ME)).toBe(KARI);
  });
  test("an answered question, or your own, is nobody else's turn", () => {
    expect(runningAsker([ask(KARI), answer()], ME)).toBeNull();
    expect(runningAsker([ask(ME)], ME)).toBeNull();
    expect(runningAsker([], ME)).toBeNull();
  });
});

describe("someoneElseAdded", () => {
  test("your own question and its answer are on screen already", () => {
    expect(someoneElseAdded([], [ask(ME), answer()], ME)).toBe(false);
  });
  test("someone else's question shows the chat again", () => {
    expect(
      someoneElseAdded([ask(ME), answer()], [ask(ME), answer(), ask(KARI)], ME),
    ).toBe(true);
  });
  test("so does the answer to it, when the question was seen before", () => {
    expect(someoneElseAdded([ask(KARI)], [ask(KARI), answer()], ME)).toBe(true);
  });
  test("nothing new is nothing to show", () => {
    expect(someoneElseAdded([ask(ME), answer()], [ask(ME), answer()], ME)).toBe(
      false,
    );
  });
  test("a chat that got shorter is shown as it is now", () => {
    expect(someoneElseAdded([ask(ME), answer()], [ask(ME)], ME)).toBe(true);
  });
});

describe("applyWatchedEvent", () => {
  const KARI_P = { id: KARI, name: "Kari" };

  function watching() {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
    const turnBy: (ProposalParticipant | null)[] = [];
    const ended: boolean[] = [];
    const watched: WatchedChat = {
      chat: {
        appendMessage: record("appendMessage"),
        startAssistantMessage: record("start"),
        appendAssistantChunk: record("chunk"),
        completeAssistantMessage: record("complete"),
        errorAssistantMessage: record("error"),
        addToolCall: record("tool"),
        completeToolCall: record("toolDone"),
        errorToolCall: record("toolFailed"),
      },
      activeId: { current: null },
      started: new Set(),
      participantOf: (id) => (id === KARI ? KARI_P : { id, name: "?" }),
      setTurnBy: (by) => turnBy.push(by),
      turnEnded: (joinedMidway) => ended.push(joinedMidway),
    };
    const send = (event: AIWatchedMessage["event"]) =>
      applyWatchedEvent(event, watched);
    return { calls, turnBy, ended, send, watched };
  }

  test("someone else's question, then its answer as it streams", () => {
    const { calls, turnBy, ended, send } = watching();
    send({
      type: "ai_turn_started",
      id: "q1",
      sessionId: "chat-1",
      authorId: KARI,
      message: [{ type: "text", text: "Shorter title?" }],
    });
    send({ type: "ai_streaming", id: "q1", chunk: "Su" });
    send({ type: "ai_streaming", id: "q1", chunk: "re" });
    send({
      type: "ai_response",
      id: "q1",
      sessionId: "chat-1",
      response: "Sure",
      metadata: { outputTokens: 3 },
    });
    send({ type: "ai_turn_ended", id: "q1", sessionId: "chat-1" });

    expect(calls).toEqual([
      [
        "appendMessage",
        {
          id: "watched-q1",
          role: "user",
          content: "Shorter title?",
          status: "complete",
          author: KARI_P,
        },
      ],
      // Started once, not per chunk: starting again would drop what streamed.
      ["start", "q1"],
      ["chunk", "q1", "Su"],
      ["chunk", "q1", "re"],
      ["complete", "q1", { outputTokens: 3 }],
    ]);
    // Kari holds the chat until the turn ends, and then nobody does.
    expect(turnBy).toEqual([KARI_P, null]);
    // The question was seen asked, so the chat is not shown again.
    expect(ended).toEqual([false]);
  });

  test("each tool the turn runs is a row, and says how it went", () => {
    const { calls, send } = watching();
    const tool = (
      status: "pending" | "complete" | "error",
      toolCallId: string,
    ) =>
      send({
        type: "ai_tool_activity",
        id: "q1",
        toolCallId,
        name: "create_patch",
        status,
      });
    tool("pending", "t1");
    tool("complete", "t1");
    tool("pending", "t2");
    tool("error", "t2");
    expect(calls).toEqual([
      // A tool can come before any text: the answer opens with it.
      ["start", "q1"],
      ["tool", "q1", "t1", "create_patch"],
      ["toolDone", "q1", "t1"],
      ["tool", "q1", "t2", "create_patch"],
      ["toolFailed", "q1", "t2"],
    ]);
  });

  test("an answer that did not stream is shown whole", () => {
    const { calls, send } = watching();
    send({
      type: "ai_response",
      id: "q1",
      sessionId: "chat-1",
      response: "Done",
    });
    expect(calls).toEqual([
      ["start", "q1"],
      ["chunk", "q1", "Done"],
      ["complete", "q1", { outputTokens: undefined }],
    ]);
  });

  test("a stopped turn keeps what it had, or says it stopped", () => {
    const partial = watching();
    partial.send({
      type: "ai_streaming",
      id: "q1",
      chunk: "Half",
    });
    partial.send({
      type: "ai_cancelled",
      id: "q1",
      sessionId: "chat-1",
      partialResponse: "Half",
    });
    expect(partial.calls).toEqual([
      ["start", "q1"],
      ["chunk", "q1", "Half"],
      ["complete", "q1", { stopped: true }],
    ]);

    const silent = watching();
    silent.send({ type: "ai_cancelled", id: "q1", sessionId: "chat-1" });
    expect(silent.calls).toEqual([
      ["start", "q1"],
      ["chunk", "q1", "Stopped.", { fromModel: false }],
      ["complete", "q1", { stopped: true }],
    ]);
  });

  test("a failed turn shows why", () => {
    const { calls, send } = watching();
    send({
      type: "ai_error",
      id: "q1",
      code: "internal_error",
      message: "The model could not be reached.",
    });
    expect(calls).toEqual([
      ["start", "q1"],
      ["error", "q1", "The model could not be reached.", "internal_error"],
    ]);
  });

  test("a turn joined midway shows the chat again when it ends", () => {
    const { ended, send, watched } = watching();
    send({ type: "ai_streaming", id: "q1", chunk: "…" });
    send({ type: "ai_turn_ended", id: "q1", sessionId: "chat-1" });
    expect(ended).toEqual([true]);
    expect(watched.activeId.current).toBeNull();
  });
});

describe("watchedQuestionText", () => {
  test("the question, without the image keys meant for the model", () => {
    expect(
      watchedQuestionText([
        {
          type: "text",
          text: 'Use this one\n\n[Attached images — …:\n- a.png: image_key="k"]',
        },
        { type: "image_key", key: "k" },
      ]),
    ).toBe("Use this one");
    expect(watchedQuestionText("Plain")).toBe("Plain");
  });
});

describe("the relay, as the content server sends it", () => {
  test("a watched turn's events parse, so none is dropped", () => {
    // As valbuild/home's `relayToWatchers` wraps them.
    const wrap = (event: object) => ({
      type: "ai_watched",
      sessionId: "chat-1",
      event,
    });
    for (const event of [
      {
        type: "ai_turn_started",
        id: "q1",
        sessionId: "chat-1",
        authorId: KARI,
        message: [
          { type: "text", text: "Hi" },
          { type: "image_key", key: "k" },
        ],
      },
      { type: "ai_streaming", id: "q1", chunk: "Hel" },
      {
        type: "ai_tool_activity",
        id: "q1",
        toolCallId: "t1",
        name: "create_patch",
        status: "pending",
      },
      {
        type: "ai_response",
        id: "q1",
        sessionId: "chat-1",
        response: "Hello",
        metadata: { outputTokens: 2 },
      },
      { type: "ai_cancelled", id: "q1", sessionId: "chat-1" },
      { type: "ai_error", id: "q1", code: "session_busy", message: "Busy" },
      { type: "ai_turn_ended", id: "q1", sessionId: "chat-1" },
    ]) {
      expect(AIServerMessage.safeParse(wrap(event)).success).toBe(true);
    }
    expect(
      AIServerMessage.safeParse({
        type: "ai_watching",
        sessionId: "chat-1",
        runningAuthorId: null,
      }).success,
    ).toBe(true);
  });
});

describe("storedToolActivities", () => {
  const question = {
    question: "Which headline?",
    options: [{ label: "Short" }, { label: "Long" }],
  };
  test("a kept tool call is the row the answer showed", () => {
    expect(
      storedToolActivities([
        { toolCallId: "t1", name: "get_source", isError: false },
        { toolCallId: "t2", name: "create_patch", isError: true },
      ]),
    ).toEqual([
      { toolCallId: "t1", name: "get_source", status: "complete" },
      { toolCallId: "t2", name: "create_patch", status: "error" },
    ]);
  });
  test("an answered question shows what was asked and answered", () => {
    const answers = [
      { question: "Which headline?", selectedOptions: [0], customAnswer: null },
    ];
    expect(
      storedToolActivities([
        {
          toolCallId: "t1",
          name: "ask_user_question",
          isError: false,
          questions: [question],
          answers,
        },
      ]),
    ).toEqual([
      {
        toolCallId: "t1",
        name: "ask_user_question",
        status: "complete",
        questions: [question],
        answers,
      },
    ]);
  });
  test("a question nobody answered can no longer be answered", () => {
    const [declined] = storedToolActivities([
      {
        toolCallId: "t1",
        name: "ask_user_question",
        isError: true,
        questions: [question],
      },
    ]);
    expect(declined).toMatchObject({ status: "error", cancelled: true });
  });
  test("a question that cannot be drawn is a plain row", () => {
    expect(
      storedToolActivities([
        {
          toolCallId: "t1",
          name: "ask_user_question",
          isError: false,
          questions: [{ nonsense: true }],
        },
      ]),
    ).toEqual([
      { toolCallId: "t1", name: "ask_user_question", status: "complete" },
    ]);
  });
});
