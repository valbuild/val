import { runningAsker, someoneElseAdded } from "./sharedChat";

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
