/** @jest-environment jsdom */
// FIRST, and it must stay first: `StringField` pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";

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

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useFieldCreatorId: () => "test",
  useSchemaAtPath: () => mockSchema(),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: [], addPatch: jest.fn() }),
  // The seam the field actually reads through. Composed from the two mocks
  // above rather than stubbed separately, so what this file controls — the
  // schema and the source — is unchanged by where the field gets them from.
  useValField: () => ({
    schema: mockSchema(),
    source: mockSource(),
    hasUnsavedOwnEdit: false,
    patchPath: [],
    addPatch: jest.fn(),
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
});
