/**
 * @jest-environment jsdom
 */
import { studioAITurnTrace } from "./aiTurnTrace";
import type { AIPromptMessage } from "./useAIWebSocket";

/*
 * The Studio's own trace is for whoever is debugging Val: with debug off,
 * nothing of a turn is recorded or kept, and the console has nothing to
 * read. Decided when a prompt is sent.
 */
const prompt = (id: string): AIPromptMessage => ({
  type: "ai_prompt",
  id,
  message: "Hello",
  agents: [
    {
      id: "val",
      systemPrompt: "",
      model: { provider: "anthropic", model: "claude-sonnet-5-5" },
    },
  ],
});
const turn = (id: string) => {
  studioAITurnTrace.sent(prompt(id));
  studioAITurnTrace.received({
    type: "ai_response",
    id,
    sessionId: "s1",
    response: "Hi.",
  });
};

afterEach(() => window.localStorage.clear());

test("nothing is recorded, and nothing is on the window, while debug is off", () => {
  turn("p1");
  expect(window.__VAL_AI_TURNS__).toBeUndefined();
});

test("with debug on, turns are kept for the console; turned off again, they are let go", () => {
  const debug = jest.spyOn(console, "debug").mockImplementation(() => {});
  window.localStorage.setItem("val:debug", "1");
  turn("p1");
  turn("p2");
  expect(window.__VAL_AI_TURNS__?.turns.map((each) => each.id)).toEqual([
    "p1",
    "p2",
  ]);
  expect(window.__VAL_AI_TURNS__?.text()).toContain("assistant turn p2");
  expect(window.__VAL_AI_TURNS__?.text(1)).toContain("assistant turn p1");
  expect(JSON.parse(window.__VAL_AI_TURNS__?.json() ?? "null").end).toBe(
    "response",
  );
  // Printed as each ended.
  expect(debug).toHaveBeenCalledTimes(2);

  window.localStorage.removeItem("val:debug");
  turn("p3");
  expect(window.__VAL_AI_TURNS__).toBeUndefined();
  debug.mockRestore();
});
