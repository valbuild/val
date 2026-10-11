/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { initVal, Schema, SelectorSource, SourcePath } from "@valbuild/core";

/**
 * WHICH LIST an array field draws, which is a different claim from what either
 * list draws.
 *
 * `isInlineRender` is pinned in `core/src/schema/render.test.ts` and the rows
 * themselves are pinned in the browser (`e2e/inline-render.spec.ts`). Neither
 * covers the seam between them: an `ArrayFields` that asked the ITEM instead of
 * the array passes every test in that file and still draws preview rows for
 * the list that declared itself inline. That seam is this file. See
 * `e2e/README.md`.
 *
 * Both lists are stubbed to a marker, deliberately: the claim is the choice, so
 * anything about how a row looks would only make this test fail for reasons it
 * is not about.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();
const mockAddPatch = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  usePreviewAtPath: () => undefined,
  useSourceAtPath: () => mockSource(),
  useShallowSourceAtPath: () => mockSource(),
  // `FieldNull` reads the schema (through `useParent`) and writes through
  // `useAddPatch`, so the null branch needs both.
  useSchemaAtPath: () => mockSchema(),
  useAddPatch: () => ({ patchPath: [], addPatch: mockAddPatch }),
  useValField: () => ({
    schema: mockSchema(),
    source: mockSource(),
    hasUnsavedOwnEdit: false,
    patchPath: [],
    addPatch: mockAddPatch,
  }),
}));

jest.mock("../../components/BlockList", () => ({
  __esModule: true,
  BlockList: () => <div data-testid="block-list" />,
}));

jest.mock("../../components/SortableList", () => ({
  __esModule: true,
  SortableList: () => <div data-testid="sortable-list" />,
  SortableContainer: () => <div data-testid="sortable-container" />,
}));

jest.mock("../../components/ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
}));

// The generic dispatchers, which would otherwise drag in the whole field tree
// (and, through `ValProvider`, a worker URL jest cannot parse).
jest.mock("../../components/AnyField", () => ({
  __esModule: true,
  AnyField: () => <div data-testid="any-field" />,
}));
jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => <div data-testid="preview-loading" />,
  PreviewNull: () => <div data-testid="preview-null" />,
}));
// `Field` reaches `ValProvider` through `ArrayAndRecordTools`, and that pulls in
// the validation bridge — an ESM module jest cannot require.
jest.mock("../../components/Field", () => ({
  __esModule: true,
  Field: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../components/InlineSortableItem", () => ({
  __esModule: true,
  InlineSortableItem: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("../PreviewError", () => ({
  __esModule: true,
  PreviewError: () => <div data-testid="preview-error" />,
}));

import { ArrayFields } from "./ArrayFields";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="sections"' as SourcePath;

/** Mount `array`, holding one element. */
function mount(array: Schema<SelectorSource>) {
  mockSchema.mockReturnValue({
    status: "success",
    data: array["executeSerialize"](),
  });
  mockSource.mockReturnValue({
    status: "success",
    data: [`${PATH}.0` as SourcePath],
  });
}

/** Mount `array` with NO source: the list has not been created. */
function mountNull(array: Schema<SelectorSource>) {
  mockSchema.mockReturnValue({
    status: "success",
    data: array["executeSerialize"](),
  });
  mockSource.mockReturnValue({ status: "success", data: null });
}

const textBlock = s.object({ type: s.literal("text"), text: s.string() });
const codeBlock = s.object({ type: s.literal("code"), code: s.string() });

describe("ArrayFields picks its list from the ARRAY's render", () => {
  test("an inline array is edited in the block list", () => {
    mount(s.array(s.object({ title: s.string() })).render({ as: "inline" }));
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  /**
   * The page builder: neither the union nor its blocks carry a render, and
   * they do not have to — the list says it.
   */
  test("an inline array of a union is edited in the block list", () => {
    mount(
      s
        .array(s.discriminatedUnion("type", textBlock, codeBlock))
        .render({ as: "inline" }),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  test("an array with no render keeps the preview rows", () => {
    mount(s.array(s.object({ title: s.string() })));
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("sortable-list")).not.toBeNull();
    expect(screen.queryByTestId("block-list")).toBeNull();
  });

  /**
   * An inline array INSIDE the item says nothing about the list the item is
   * in: a render reaches one level down and no further.
   */
  test("an inline array nested in the item does not make this list inline", () => {
    mount(
      s.array(s.object({ tags: s.array(s.string()).render({ as: "inline" }) })),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("sortable-list")).not.toBeNull();
    expect(screen.queryByTestId("block-list")).toBeNull();
  });

  /**
   * A `preview` does not get a say in this. It describes the value where the
   * value is only referred to; the render decides how the field is drawn, and
   * where both are declared the render wins — see
   * `architecture/render-and-preview.md`.
   */
  test("a preview on the item does not take the block list away", () => {
    mount(
      s
        .array(
          s
            .object({ title: s.string() })
            .preview(({ val }) => ({ title: val.title })),
        )
        .render({ as: "inline" }),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  test("a preview without a render still gets the preview rows", () => {
    mount(
      s.array(
        s
          .object({ title: s.string() })
          .preview(({ val }) => ({ title: val.title })),
      ),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("sortable-list")).not.toBeNull();
    expect(screen.queryByTestId("block-list")).toBeNull();
  });
});

/**
 * A `null` array is not an empty one. Rendering the sortable list over it
 * offered an "add" whose patch would have written index 0 into `null`, and
 * showed an empty list where the truth is that the list does not exist.
 */
describe("ArrayFields on a null source", () => {
  beforeEach(() => {
    mockAddPatch.mockClear();
  });

  test("draws the create button, and neither list", () => {
    mountNull(s.array(s.object({ title: s.string() })).nullable());
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("sortable-list")).toBeNull();
    expect(screen.queryByTestId("block-list")).toBeNull();
    expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeNull();
  });

  test("an inline array does not reach the block list either", () => {
    // The inline branch runs BEFORE the list is drawn, so the null check has
    // to come before it too.
    mountNull(
      s
        .array(s.object({ title: s.string() }))
        .render({ as: "inline" })
        .nullable(),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).toBeNull();
    expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeNull();
  });

  test("creating writes an empty array, not null", () => {
    mountNull(s.array(s.object({ title: s.string() })).nullable());
    render(<ArrayFields path={PATH} />);
    screen.getByRole("button").click();
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: [], value: [] }],
      "array",
    );
  });

  test("readonly cannot create it", () => {
    mountNull(s.array(s.object({ title: s.string() })).nullable());
    render(<ArrayFields path={PATH} readonly />);
    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    button.click();
    expect(mockAddPatch).not.toHaveBeenCalled();
  });
});
