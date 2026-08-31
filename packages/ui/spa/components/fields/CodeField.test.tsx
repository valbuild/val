/** @jest-environment jsdom */
// FIRST, and it must stay first: `CodeField` pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";

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
// field hands it.
jest.mock("../CodeEditor", () => ({
  __esModule: true,
  CodeEditor: ({ language, value }: { language?: string; value: string }) => (
    <div data-testid="code-editor" data-language={language ?? "none"}>
      {value}
    </div>
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
    const editor = screen.getByTestId("code-editor");
    expect(editor.getAttribute("data-language")).toBe("typescript");
    expect(editor.textContent).toBe("const a = 1;");
  });

  test("no language: the editor gets none, rather than a guessed one", () => {
    mount(undefined, "plain text");
    render(<CodeField path={PATH} />);
    const editor = screen.getByTestId("code-editor");
    expect(editor.getAttribute("data-language")).toBe("none");
    expect(editor.textContent).toBe("plain text");
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
