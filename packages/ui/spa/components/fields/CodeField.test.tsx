/** @jest-environment jsdom */
// FIRST, and it must stay first: `CodeField` pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import { FIELD_WRITE_DEBOUNCE_MS } from "./useDebouncedFieldWrite";

/**
 * `s.code()` is its own field, and the language comes off the SCHEMA — the same
 * synchronous read `StringField` does for `multiline`, so there is nothing to
 * wait for and no frame drawn without highlighting.
 *
 * `undefined` is a real state here rather than a missing one: `s.code()` with no
 * language is a monospaced editor with no highlighting, and the field must pass
 * that through instead of picking a language of its own.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();
const mockAddPatch = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useFieldCreatorId: () => "test",
  useSchemaAtPath: () => mockSchema(),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: [], addPatch: mockAddPatch }),
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

// CodeMirror needs a real layout to mount into; what matters here is what the
// field hands it, and that what it hands back reaches `onChange`. The stub is a
// textarea rather than a div so a keystroke can be fired at it — the debounce
// test below is the reason.
jest.mock("../CodeEditor", () => ({
  __esModule: true,
  CodeEditor: ({
    language,
    value,
    onChange,
  }: {
    language?: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid="code-editor"
      data-language={language ?? "none"}
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
    />
  ),
}));

import { CodeField } from "./CodeField";

const PATH = '/content/page.val.ts?p="snippet"' as SourcePath;

function mount(options: { language?: string } | undefined, source: string) {
  mockSchema.mockReturnValue({
    status: "success",
    data: { type: "code", opt: false, options },
  });
  mockSource.mockReturnValue({ status: "success", data: source });
}

describe("CodeField", () => {
  test("the code editor, with the language the schema names", () => {
    mount({ language: "typescript" }, "const a = 1;");
    render(<CodeField path={PATH} />);
    const editor = screen.getByTestId<HTMLTextAreaElement>("code-editor");
    expect(editor.getAttribute("data-language")).toBe("typescript");
    expect(editor.value).toBe("const a = 1;");
  });

  test("no language: the editor gets none, rather than a guessed one", () => {
    mount(undefined, "plain text");
    render(<CodeField path={PATH} />);
    const editor = screen.getByTestId<HTMLTextAreaElement>("code-editor");
    expect(editor.getAttribute("data-language")).toBe("none");
    expect(editor.value).toBe("plain text");
  });

  /**
   * A burst of typing is ONE write, and this field is what collapses it.
   *
   * The same seam `StringField.test.tsx` pins, and it has to be pinned here
   * too: `useDebouncedFieldWrite.test.tsx` proves the hook, but nothing there
   * can show that THIS field goes through it. A field calling `addPatch`
   * straight from `onChange` would pass every test in that file and put one
   * patch per keystroke on the chain — and code is typed in longer bursts than
   * prose. On a fake clock the margin is exact and there is no flake to have.
   */
  test("a burst of keystrokes is one write, carrying the last value", () => {
    jest.useFakeTimers();
    try {
      mount({ language: "typescript" }, "");
      render(<CodeField path={PATH} />);
      const editor = screen.getByTestId("code-editor");

      for (const value of ["c", "co", "con", "cons", "const"]) {
        fireEvent.change(editor, { target: { value } });
        act(() => {
          jest.advanceTimersByTime(60);
        });
      }
      // The half that a per-keystroke write would fail.
      expect(mockAddPatch).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(FIELD_WRITE_DEBOUNCE_MS);
      });
      expect(mockAddPatch).toHaveBeenCalledTimes(1);
      expect(mockAddPatch.mock.calls[0][0]).toEqual([
        { op: "replace", path: [], value: "const" },
      ]);
      // The patch is tagged as a code write, not a string one: the type decides
      // which schema the server validates the patch against.
      expect(mockAddPatch.mock.calls[0][1]).toBe("code");
    } finally {
      jest.useRealTimers();
    }
  });

  test("a schema of another type is a mismatch, not a blank editor", () => {
    mockSchema.mockReturnValue({
      status: "success",
      data: { type: "string", opt: false, raw: false },
    });
    mockSource.mockReturnValue({ status: "success", data: "const a = 1;" });
    render(<CodeField path={PATH} />);
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });
});
