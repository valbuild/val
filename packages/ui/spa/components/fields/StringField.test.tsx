/** @jest-environment jsdom */
// FIRST, and it must stay first: `StringField` pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import { FIELD_WRITE_DEBOUNCE_MS } from "./useDebouncedFieldWrite";

/**
 * A string field's LAYOUT comes off the serialized schema, synchronously.
 *
 * That is the point of the preview/render split: a `render` is static config, so
 * there is nothing to wait for and no flash of a single-line input before the
 * textarea. What is pinned here is the consequence that bit.
 *
 * The textarea used to be UNCONTROLLED (`defaultValue`), and it worked only
 * because the layout arrived a tick AFTER the effect that fills `currentValue`,
 * so it mounted with the text already in hand. `AutoGrowingTextarea` seeds its
 * sizing ghost from props exactly once, at mount — so with the layout now
 * synchronous, an uncontrolled textarea mounts at `null`, the ghost is seeded
 * empty, and the box stays one line tall however long the text is. The
 * `.value` assertion alone does NOT catch that (a textarea's value follows
 * `defaultValue` while it is untouched); the ghost assertion does.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();
/**
 * ONE spy, shared by both seams, so writes are observable.
 *
 * A fresh `jest.fn()` per `useValField()` call — which is what this was — is
 * unobservable by construction: every render hands the field a different
 * function and the test holds none of them. Nothing here asserted on writes, so
 * it did not matter until the debounce test below.
 */
const mockAddPatch = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useFieldCreatorId: () => "test",
  useSchemaAtPath: () => mockSchema(),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: [], addPatch: mockAddPatch }),
  // The seam the field actually reads through. Composed from the two mocks
  // above rather than stubbed separately, so what this file controls — the
  // schema and the source — is unchanged by where the field gets them from.
  useValField: () => ({
    schema: mockSchema(),
    source: mockSource(),
    hasUnsavedOwnEdit: false,
    patchPath: [],
    addPatch: mockAddPatch,
    addAndUploadPatchWithFileOps: jest.fn(),
    addModuleFilePatch: jest.fn(),
  }),
}));

// `Preview` is the generic field dispatcher, so importing it drags in the whole
// field tree (and, through `ValProvider`, a worker URL jest cannot parse). This
// field only uses two leaf states from it.
jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => <div data-testid="preview-loading" />,
  PreviewNull: () => <div data-testid="preview-null" />,
}));

jest.mock("../CodeEditor", () => ({
  __esModule: true,
  CodeEditor: ({ language, value }: { language: string; value: string }) => (
    <div data-testid="code-editor" data-language={language}>
      {value}
    </div>
  ),
}));

import { StringField } from "./StringField";

const PATH = '/content/page.val.ts?p="body"' as SourcePath;

function mount(render: unknown, source: string) {
  mockSchema.mockReturnValue({
    status: "success",
    data: { type: "string", opt: false, raw: false, render },
  });
  mockSource.mockReturnValue({ status: "success", data: source });
  return render;
}

describe("StringField", () => {
  test("a plain string is a single-line input carrying its value", () => {
    mount(undefined, "Hello");
    const { container } = render(<StringField path={PATH} />);
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(input!.value).toBe("Hello");
  });

  test("render textarea: a textarea, on the first frame, with its value in it", () => {
    mount({ as: "textarea" }, "Multiline\ntext");
    const { container } = render(<StringField path={PATH} />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(textarea!.value).toBe("Multiline\ntext");
  });

  /** The regression guard — see the note at the top of this file. */
  test("render textarea: the auto-grow ghost is sized for the value", () => {
    mount({ as: "textarea" }, "Multiline\ntext");
    render(<StringField path={PATH} />);
    expect(
      screen.getByTestId("auto-growing-textarea-ghost").textContent,
    ).toContain("Multiline\ntext");
  });

  test("render code: the code editor, with the language the schema names", () => {
    mount({ as: "code", language: "typescript" }, "const a = 1;");
    render(<StringField path={PATH} />);
    const editor = screen.getByTestId("code-editor");
    expect(editor.getAttribute("data-language")).toBe("typescript");
    expect(editor.textContent).toBe("const a = 1;");
  });

  /**
   * A burst of typing is ONE write, and this field is what collapses it.
   *
   * `useDebouncedFieldWrite.test.tsx` already pins the hook. What it cannot pin
   * is that `StringField` USES it: a field that called `addPatch` straight from
   * `onChange` would pass every test in that file and put one patch per keystroke
   * on the chain. Only the seam shows it, which is why this lives here.
   *
   * It used to live in `studio-ui.spec.ts`, where it typed five keys 60ms apart
   * against a 250ms debounce and asserted the chain grew by exactly one. That is
   * 190ms of slack per keystroke, and every keystroke is a CDP round trip on a
   * box also running `next dev`, Vite and Chromium — so one stall over 190ms
   * split the burst and failed the run. The property was never about wall-clock
   * time; it is about which timer the field arms. On a fake clock the margin is
   * exact and the flake cannot exist.
   */
  test("a burst of keystrokes is one write, carrying the last value", () => {
    jest.useFakeTimers();
    try {
      mount(undefined, "");
      const { container } = render(<StringField path={PATH} />);
      const input = container.querySelector("input")!;

      // Spaced the way the e2e test spaced them, so this is the same claim:
      // gaps well inside the window, and the window never elapses mid-burst.
      for (const value of ["T", "Ty", "Typ", "Type", "Typed"]) {
        fireEvent.change(input, { target: { value } });
        act(() => {
          jest.advanceTimersByTime(60);
        });
      }
      expect(
        mockAddPatch,
        // The half that a per-keystroke write would fail.
      ).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(FIELD_WRITE_DEBOUNCE_MS);
      });
      expect(mockAddPatch).toHaveBeenCalledTimes(1);
      expect(mockAddPatch.mock.calls[0][0]).toEqual([
        { op: "replace", path: [], value: "Typed" },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
