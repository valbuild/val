import { decideBubble } from "./aiChatBubble";

/**
 * The case this file exists for is the last one: a finished turn that ran
 * tools and said nothing. Moving tool calls out of the bubble made the bubble
 * skippable, and skipping it there silenced "Empty response" — so an empty
 * model reply rendered as a tidy row of green ticks and nothing else.
 */

const assistant = {
  isUser: false,
  isError: false,
  isStreaming: false,
  hasText: false,
  hasFiles: false,
  hasRunningTool: false,
  hasPendingQuestion: false,
};

describe("decideBubble", () => {
  it("hides the bubble while a tool is still running with no text yet", () => {
    expect(
      decideBubble({ ...assistant, isStreaming: true, hasRunningTool: true }),
    ).toEqual({ hasBubble: false, showCursor: false });
  });

  it("shows bubble and cursor once text starts arriving mid-tool", () => {
    expect(
      decideBubble({
        ...assistant,
        isStreaming: true,
        hasRunningTool: true,
        hasText: true,
      }),
    ).toEqual({ hasBubble: true, showCursor: true });
  });

  it("shows the cursor while streaming with no tools running", () => {
    expect(decideBubble({ ...assistant, isStreaming: true })).toEqual({
      hasBubble: true,
      showCursor: true,
    });
  });

  it("hides the bubble while the turn is blocked on a question", () => {
    expect(
      decideBubble({
        ...assistant,
        isStreaming: true,
        hasPendingQuestion: true,
      }),
    ).toEqual({ hasBubble: false, showCursor: false });
  });

  it("keeps the bubble for an error, so the retry button has a home", () => {
    expect(decideBubble({ ...assistant, isError: true })).toEqual({
      hasBubble: true,
      showCursor: false,
    });
  });

  it("keeps the bubble for images with no text", () => {
    expect(decideBubble({ ...assistant, hasFiles: true })).toEqual({
      hasBubble: true,
      showCursor: false,
    });
  });

  it("always keeps the bubble for a user message", () => {
    expect(decideBubble({ ...assistant, isUser: true })).toEqual({
      hasBubble: true,
      showCursor: false,
    });
  });

  it("keeps the bubble for a FINISHED turn that ran tools and said nothing", () => {
    // The regression: without this the turn renders as tool row only, and an
    // empty response is indistinguishable from tools that simply worked.
    expect(decideBubble({ ...assistant, hasRunningTool: false })).toEqual({
      hasBubble: true,
      showCursor: false,
    });
  });

  it("keeps the bubble for a finished turn with no tools at all", () => {
    expect(decideBubble(assistant)).toEqual({
      hasBubble: true,
      showCursor: false,
    });
  });
});
