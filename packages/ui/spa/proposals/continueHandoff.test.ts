/** @jest-environment jsdom */
import {
  CONTINUE_PARAM,
  codeModeContinuation,
  continuationOf,
  markContinued,
  wasContinued,
  withContinuation,
  withoutContinuation,
} from "./continueHandoff";

/**
 * A conversation carried to another Studio carries on there by itself, at
 * most once (`continueHandoff.ts`): the `</>` menu takes a code-mode request
 * from the site to a proposal, and the proposal's Studio sends the message
 * that continues it.
 *
 * Only an id travels in the address, never words: a link that made the
 * assistant say something would be a prompt anyone could write and someone
 * signed in would run.
 */
describe("a conversation handed on to another Studio", () => {
  beforeEach(() => localStorage.clear());

  test("goes with an id of its own, and is read back from the address", () => {
    const url = withContinuation("https://p.example.com/val?session=s1", "c-1");
    expect(new URL(url).searchParams.get(CONTINUE_PARAM)).toBe("c-1");
    expect(continuationOf(url)).toBe("c-1");
    expect(continuationOf("https://p.example.com/val?session=s1")).toBeNull();
    expect(withoutContinuation(url)).toBe(
      "https://p.example.com/val?session=s1",
    );
  });

  test("an id used here is not used again: a reload sends nothing", () => {
    expect(wasContinued("c-1")).toBe(false);
    markContinued("c-1");
    expect(wasContinued("c-1")).toBe(true);
    expect(wasContinued("c-2")).toBe(false);
  });

  const asked = (toolCalls: { name: string }[]) => ({
    role: "user",
    content: "Make the hero dark",
    toolCalls: toolCalls.map((call, i) => ({
      toolCallId: `t${i}`,
      name: call.name,
      isError: false,
    })),
  });

  test("is due while the conversation ends on the request for code mode", () => {
    const due = codeModeContinuation(
      [
        asked([{ name: "request_code_mode" }]),
        { role: "assistant", content: "Open the proposal." },
      ],
      "Spring",
    );
    expect(due).not.toBeNull();
    expect(due).toContain("Spring");
  });

  test("is not due once it was continued, anywhere: the next turn is after it", () => {
    expect(
      codeModeContinuation(
        [
          asked([{ name: "request_code_mode" }]),
          { role: "assistant", content: "Open the proposal." },
          { role: "user", content: "Code mode is on…", toolCalls: [] },
        ],
        "Spring",
      ),
    ).toBeNull();
  });

  test("nor in a conversation that did not ask for it", () => {
    expect(
      codeModeContinuation(
        [asked([{ name: "read_file" }]), { role: "assistant", content: "x" }],
        "Spring",
      ),
    ).toBeNull();
    expect(codeModeContinuation([], "Spring")).toBeNull();
  });
});
