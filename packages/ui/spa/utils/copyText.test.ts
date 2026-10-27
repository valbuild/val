/** @jest-environment jsdom */
import { copyText } from "./copyText";

/**
 * Both halves of the clipboard, because only one of them is ever exercised by
 * hand.
 *
 * `navigator.clipboard` is secure-context only, so a developer testing on
 * `localhost` always takes the native path and would never notice the fallback
 * regressing — or a return to calling `navigator.clipboard.writeText` straight,
 * which is the bug this file exists to prevent coming back.
 */
describe("copyText", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalExecCommand = document.execCommand;

  function setClipboard(value: unknown) {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    }
    document.execCommand = originalExecCommand;
    document.body.innerHTML = "";
  });

  test("uses the clipboard API where there is one", () => {
    const writeText = jest.fn();
    setClipboard({ writeText });
    const execCommand = jest.fn(() => true);
    document.execCommand = execCommand;

    copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    // The fallback is a fallback: it does not also run, and it leaves nothing
    // in the document.
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("an insecure context has no clipboard, and still copies", () => {
    setClipboard(undefined);
    let copiedFrom: string | undefined;
    document.execCommand = jest.fn((command: string) => {
      // What the browser copies is the selection, so the assertion has to read
      // the element rather than the argument: `execCommand("copy")` says
      // nothing about what it copied.
      const textarea = document.querySelector("textarea");
      if (command === "copy" && textarea) {
        copiedFrom = textarea.value;
      }
      return true;
    });

    copyText("hello");

    expect(copiedFrom).toBe("hello");
    // And it cleans up after itself: a textarea left on `document.body` is a
    // stray tab stop on every page of the Studio from then on.
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("cleans up even when the copy command throws", () => {
    setClipboard(undefined);
    document.execCommand = jest.fn(() => {
      throw new Error("not supported");
    });

    expect(() => copyText("hello")).toThrow("not supported");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
