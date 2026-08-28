/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { AIChatPanel } from "./AIChatPanel";

/**
 * The assistant panel when there is no assistant.
 *
 * The AI connection used to retry forever, and the panel knew nothing about it:
 * a composer, a Send button and a row of suggestions, with nothing on the other
 * end. Someone typing a question into that gets silence, and no way to tell the
 * difference between a slow answer and no connection at all.
 *
 * So what is checked here is the swap — that the assistant is *gone*, not merely
 * that a message was added next to it — and that the retry is wired, because the
 * retry is the only part of this a person can act on.
 *
 * The chat itself is a stand-in here, and deliberately so: the real one holds a
 * socket and the whole tool implementation, and what this file is about is the
 * panel's one decision. `e2e/http/aiChat.spec.ts` drives the real one.
 */
function panel(props: Partial<Parameters<typeof AIChatPanel>[0]> = {}) {
  return (
    <AIChatPanel breakpoint="desktop" onClose={() => undefined} {...props}>
      <div>The assistant</div>
    </AIChatPanel>
  );
}

describe("AIChatPanel", () => {
  test("shows the assistant when there is one", () => {
    render(panel());
    expect(screen.queryByText("The assistant")).not.toBeNull();
    expect(screen.queryByText("The assistant is unavailable")).toBeNull();
  });

  test("replaces it when there is not", () => {
    render(
      panel({
        unavailable: {
          message: "Lost the connection to the assistant",
          onRetry: () => undefined,
        },
      }),
    );
    expect(
      screen.queryByText("The assistant"),
      // A composer beside the error is an invitation to type into nothing.
    ).toBeNull();
    expect(screen.queryByText("The assistant is unavailable")).not.toBeNull();
    expect(
      screen.queryByText("Lost the connection to the assistant"),
    ).not.toBeNull();
  });

  test("asks again when told to", () => {
    let retries = 0;
    render(
      panel({
        unavailable: {
          message: "The assistant could not be started (500)",
          onRetry: () => {
            retries++;
          },
        },
      }),
    );
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retries).toBe(1);
  });
});
