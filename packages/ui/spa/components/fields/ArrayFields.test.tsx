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
 * covers the seam between them: an `ArrayFields` that read `schema.item.render`
 * directly — which is what it did — passes every test in that file and still
 * draws preview rows for the page-builder list the predicate says is inline.
 * That seam is this file. See `e2e/README.md`.
 *
 * Both lists are stubbed to a marker, deliberately: the claim is the choice, so
 * anything about how a row looks would only make this test fail for reasons it
 * is not about.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  usePreviewAtPath: () => undefined,
  useSourceAtPath: () => mockSource(),
  useShallowSourceAtPath: () => mockSource(),
  useValField: () => ({
    schema: mockSchema(),
    source: mockSource(),
    hasUnsavedOwnEdit: false,
    patchPath: [],
    addPatch: jest.fn(),
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

/** Mount an array of `item`, holding one element. */
function mount(item: Schema<SelectorSource>) {
  mockSchema.mockReturnValue({
    status: "success",
    data: s.array(item)["executeSerialize"](),
  });
  mockSource.mockReturnValue({
    status: "success",
    data: [`${PATH}.0` as SourcePath],
  });
}

const textBlock = s
  .object({ type: s.literal("text"), text: s.string() })
  .render({ as: "inline" });
const codeBlock = s
  .object({ type: s.literal("code"), code: s.string() })
  .render({ as: "inline" });

describe("ArrayFields picks its list from the item schema", () => {
  test("an inline item is edited in the block list", () => {
    mount(s.object({ title: s.string() }).render({ as: "inline" }));
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  /**
   * The one that was broken: the render is on the union's VARIANTS, so the
   * array's item schema — the union — carries none of its own.
   */
  test("a union whose variants are inline is edited in the block list", () => {
    mount(s.union("type", textBlock, codeBlock));
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  test("an item with no render keeps the preview rows", () => {
    mount(s.object({ title: s.string() }));
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
  test("a preview beside the render does not take the block list away", () => {
    mount(
      s
        .object({ title: s.string() })
        .render({ as: "inline" })
        .preview(({ val }) => ({ title: val.title })),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("sortable-list")).toBeNull();
  });

  test("a preview without a render still gets the preview rows", () => {
    mount(
      s
        .object({ title: s.string() })
        .preview(({ val }) => ({ title: val.title })),
    );
    render(<ArrayFields path={PATH} />);
    expect(screen.queryByTestId("sortable-list")).not.toBeNull();
    expect(screen.queryByTestId("block-list")).toBeNull();
  });
});
