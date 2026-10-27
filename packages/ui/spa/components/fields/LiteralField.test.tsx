/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";

/**
 * A literal in an ordinary object — `type: s.literal("bento-box")` — is a
 * constant, not a mistake. It used to render as "Literal fields are not
 * editable"; it should render as the string it holds, and not let anyone
 * change it.
 */
const mockSource = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useShallowSourceAtPath: () => mockSource(),
}));

// The real module imports the whole field tree, and with it `ValProvider`.
jest.mock("../Preview", () => ({
  __esModule: true,
  PreviewLoading: () => <div>loading</div>,
  PreviewNull: () => <div>null</div>,
}));

import { LiteralField } from "./LiteralField";

const PATH = '/content/page.val.ts?p="type"' as SourcePath;

describe("LiteralField", () => {
  beforeEach(() => {
    mockSource.mockReset();
  });

  test("shows the literal's value in a read-only input", () => {
    mockSource.mockReturnValue({ status: "success", data: "bento-box" });
    render(<LiteralField path={PATH} />);
    const input = screen.getByDisplayValue("bento-box");
    expect(input).toHaveProperty("readOnly", true);
    // Not behind `ReadonlyGuard`: that makes the subtree `inert`, which would
    // hide the value from screen readers.
    expect(input.closest('[aria-disabled="true"]')).toBeNull();
    expect(screen.queryByText(/not editable/i)).toBeNull();
  });

  test("a missing literal is not found rather than loading forever", () => {
    jest.useFakeTimers();
    mockSource.mockReturnValue({ status: "not-found" });
    render(<LiteralField path={PATH} />);
    // `FieldNotFound` waits out a grace period before it says so.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.queryByDisplayValue("bento-box")).toBeNull();
    expect(screen.getByText(/not found/i)).toBeTruthy();
    jest.useRealTimers();
  });

  test("compact shows the value as text", () => {
    mockSource.mockReturnValue({ status: "success", data: "bento-box" });
    render(<LiteralField path={PATH} compact />);
    expect(screen.getByText("bento-box")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
